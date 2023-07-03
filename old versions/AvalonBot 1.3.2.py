import random
import time
import pygame as pg
import pygame.gfxdraw
from pygame.locals import *
from modules import screen_utils, image_utils


#### INITIALIZING PYGAME
pg.init()

#### SOUNDS AND MUSIC
pg.mixer.music.set_volume(0.10)

#### SCREEN
resx = 1920  # screen width
resy = 1080  # screen height
screen = screen_utils.initialize_screen(resx, resy)

#### LOADING IMAGES
img = image_utils.load_images()
bg = img['castlewall']

#### DEFINING COLORS
black = (0, 0, 0)
darkestGray = (15, 15, 15)
darkerGray = (25, 25, 25)
darkGray = (35, 35, 35)
lightGray = (55, 55, 55)   # timer circle
lighterGray = (65, 65, 65)  # grayPassiveQ
lightestGray = (105, 105, 105, 145)
yellowishWhite = (254, 238, 199)
redMark = (130, 0, 0, 145)
blueMark = (6, 48, 84, 145)
darkWood = (128, 78, 0)
lightWood = (218, 141, 22)
lighterWood = (255, 235, 204)

#### DIMENSIONS OF VISUAL ELEMENTS

# These are also used when calculating proportions for other objects
GAME_BOARD_W = int(resx * 0.625)
GAME_BOARD_H = int(resy * 0.6852)
GOLDEN_RATIO = 1.618

# quest circles = biggest circles showing players per quest
# timer circles = smaller circles southeast of quest circles
# vote circles = smaller circles showing which round of voting

# radii
QUEST_CIRCLE_R = int(resx * 0.0448)
TIMER_CIRCLE_R = QUEST_CIRCLE_R//2
VOTE_CIRCLE_R = TIMER_CIRCLE_R

#### POSITIONS OF VISUAL ELEMENTS

# y positions
Y_QUEST_CIRCLE = int(resy / 2)  
Y_TIMER_CIRCLE = int(Y_QUEST_CIRCLE + 1.75 * TIMER_CIRCLE_R)
Y_VOTE_CIRCLE = int(Y_QUEST_CIRCLE + 5 * TIMER_CIRCLE_R)

# x positions 
X_QUEST_CIRCLE = [
    int(resx / 2 - TIMER_CIRCLE_R // 2 - QUEST_CIRCLE_R * 5),
    int(resx / 2 - TIMER_CIRCLE_R // 2 - QUEST_CIRCLE_R * 2.5),
    int(resx / 2 - TIMER_CIRCLE_R // 2),
    int(resx / 2 - TIMER_CIRCLE_R // 2 + QUEST_CIRCLE_R * 2.5),
    int(resx / 2 - TIMER_CIRCLE_R // 2 + QUEST_CIRCLE_R * 5),
]
X_VOTE_CIRCLE = [
    int(resx / 2 - TIMER_CIRCLE_R // 2 - QUEST_CIRCLE_R * 5),
    int(resx / 2 - TIMER_CIRCLE_R // 2 - QUEST_CIRCLE_R * 3.5),
    int(resx / 2 - TIMER_CIRCLE_R // 2 - QUEST_CIRCLE_R * 2),
    int(resx / 2 - TIMER_CIRCLE_R // 2 - QUEST_CIRCLE_R * 0.5),
    int(resx / 2 - TIMER_CIRCLE_R // 2 + QUEST_CIRCLE_R)
]
TIMER_CIRCLE_OFFSET = int(1.25 * TIMER_CIRCLE_R)
X_TIMER_CIRCLE = [x + TIMER_CIRCLE_OFFSET for x in X_QUEST_CIRCLE]

# TIMER
Clock = pg.time.Clock()
clock_tick = pg.USEREVENT + 1 # Custom event ID for timer
pg.time.set_timer(clock_tick, 1000) # Fires once per second
total_seconds = 0
total_minutes = 0
quest_seconds = 0
quest_minutes = 0

# QUOTES
quotes_file = "text/quotes.txt"


################### FUNCTIONS #######################

def get_random_quote():
    with open(quotes_file, "r") as file:
        quotes_list = file.readlines()
        return random.choice(quotes_list).strip()
    
random_quote = get_random_quote()


def play_sound(file_name):
    file_path = 'sounds/' + file_name
    pg.mixer.music.load(file_path)
    pg.mixer.music.play()


def draw_circle(surface, xpos, ypos, radius, color):
    pg.gfxdraw.filled_circle(surface, xpos, ypos, radius, color)
    pg.gfxdraw.aacircle(surface, xpos, ypos, radius, color) # antialiasing improves the outlines


def display_game_board():
    board_x = int(resx / 4.92)
    board_y = int(resy / 5.4)
    board_w = int(resx / 1.684)
    board_h = int(resy / 1.588)
    border_w = int(resx / 64)
    border_h = int(resx / 64) + 1
    border_color = darkGray

    # Draw board background
    pg.draw.rect(bg, border_color, [board_x, board_y, board_w, board_h])
    # Draw borders
    pg.draw.rect(bg, border_color, [board_x - border_w, board_y, border_w, board_h])
    pg.draw.rect(bg, border_color, [board_x + board_w, board_y, border_w + 1, board_h])
    pg.draw.rect(bg, border_color, [board_x, board_y - border_h + 1, board_w, border_h])
    pg.draw.rect(bg, border_color, [board_x, board_y + board_h, board_w, border_h])
    # Draw rounded corners
    radius = int(resx / 64)
    draw_circle(bg, board_x, board_y, radius, border_color)
    draw_circle(bg, board_x + board_w, board_y, radius, border_color)
    draw_circle(bg, board_x, board_y + board_h, radius, border_color)
    draw_circle(bg, board_x + board_w, board_y + board_h, radius, border_color)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def clear_board():
    # used for clearing the board
    pg.draw.rect(bg, darkGray, [int(resx / 4.92), int(resy / 5.4), int(resx / 1.684), int(resy / 1.588)])
    

def display_welcome_screen():
    linewidth = 850
    clear_board()  # this repaints the inner rectangle which makes the antialiasing look better
    pg.draw.rect(bg, lightWood, (resx // 2 - linewidth // 2, resy // 2.55, linewidth, 2))  # line

    decorative_dots = [
        (resx // 12 * 5, resy // 3 * 2, 10),
        (resx // 12 * 7, resy // 3 * 2, 10),
        (resx // 24 * 9, resy // 3 * 2, 7),
        (resx // 24 * 15, resy // 3 * 2, 7),
        (resx // 12 * 4, resy // 3 * 2, 4),
        (resx // 12 * 8, resy // 3 * 2, 4)
    ]

    for dot in decorative_dots:
        draw_circle(bg, dot[0], dot[1], dot[2], lightWood)

    imgpos = img['welcometoavalon'].get_rect(center=(resx // 2, resy // 3.45))
    bg.blit(img['welcometoavalon'], imgpos)

    font = pg.font.Font('fonts/Enchanted Land.otf', 165)
    text = font.render("How many players?", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 2.05))
    imgpos = img['howmanyplayers'].get_rect(center=(resx // 2, resy // 2.05))
    bg.blit(img['howmanyplayers'], imgpos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_player_count():
    scrollw = img['verticalscroll'].get_rect().width
    scrollh = img['verticalscroll'].get_rect().height
    scroll_xpos = resx / 2 - scrollw / 2
    scroll_ypos = resy // 3 * 2 - scrollh / 2
    bg.blit(img['verticalscroll'], (scroll_xpos, scroll_ypos))

    font = pg.font.Font('fonts/Enchanted Land.otf', 180)
    text = font.render(str(player_amount), 1, lightWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 2))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def player_count_selection():
    global player_amount, quest_players, main_menu, night

    for event in pg.event.get():
        if event.type == pg.KEYDOWN:
            if event.key == K_5:
                player_amount = 5
                quest_players = [2, 3, 2, 3, 3]
            if event.key == K_6:
                player_amount = 6
                quest_players = [2, 3, 4, 3, 4]
            if event.key == K_7:
                player_amount = 7
                quest_players = [2, 3, 3, 4, 4]
            if event.key == K_8:
                player_amount = 8
                quest_players = [3, 4, 4, 5, 5]
            if event.key == K_9:
                player_amount = 9
                quest_players = [3, 4, 4, 5, 5]
            if event.key == K_1 or event.key == K_0:
                player_amount = 10
                quest_players = [3, 4, 4, 5, 5]
            if event.key == K_RETURN and player_amount > 4:
                main_menu = False
                night = True
            esq_quits(event)
            print('Player amount is: ' + str(player_amount))


def night_phase():
    clear_board()
    font = pg.font.Font('fonts/Enchanted Land.otf', 110)
    text = font.render("-  Memorize your Character Card  -", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3))
    bg.blit(text, textpos)
    font = pg.font.Font('fonts/Enchanted Land.otf', 81)
    text = font.render("-  Close your eyes and form a fist in front of you  -", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 1.5))
    bg.blit(text, textpos)
    font = pg.font.Font('fonts/Enchanted Land.otf', 110)
    text = font.render("-    Listen for further instructions    -", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 2))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_quest_bg(players):
    print("Activating function: quest_bg...")
    font = pg.font.Font('fonts/Enchanted Land.otf', 180)
    for i in range(0, 5):
        draw_circle(bg, X_QUEST_CIRCLE[i], Y_QUEST_CIRCLE, QUEST_CIRCLE_R, lighterGray)
        text = font.render(str(players[i]), 1, darkGray)  # player amount text
        textpos = text.get_rect(center=(X_QUEST_CIRCLE[i], Y_QUEST_CIRCLE))
        bg.blit(text, textpos)
        draw_circle(bg, X_TIMER_CIRCLE[i],
                                 Y_TIMER_CIRCLE, TIMER_CIRCLE_R, lightGray)

    draw_vote_circle()
    screen.blit(bg, (0, 0))
    pg.display.flip()


def draw_vote_circle():
    font = pg.font.Font('fonts/Enchanted Land.otf', 70)
    for i in range(0, 5):
        draw_circle(bg, X_VOTE_CIRCLE[i], Y_VOTE_CIRCLE, VOTE_CIRCLE_R, lighterGray)
        text = font.render(str(i+1), 1, darkGray)
        textpos = text.get_rect(center=(X_VOTE_CIRCLE[i], Y_VOTE_CIRCLE))
        bg.blit(text, textpos)
        pg.display.flip()


def circle_color_overlay(xpos, ypos, radius, color):
    draw_circle(bg, xpos, ypos, radius, color)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def quest_fail():
    global fail_count
    fail_count += 1
    play_sound('fail.mp3')


def quest_success():
    global success_count
    success_count += 1
    play_sound('success.mp3')


def place_pointer(xpos):
    pointer_w = img['pointer'].get_rect().width # 43
    bg.blit(img['pointer'], (int(xpos - pointer_w/2), int(Y_QUEST_CIRCLE - 1.9 * QUEST_CIRCLE_R)))
    screen.blit(bg, (0, 0))
    pg.display.flip()


def move_pointer(xpos_current_quest, xpos_next_quest):
    pointer_w = img['pointer'].get_rect().width # 43
    pointer_h = img['pointer'].get_rect().height # 71
    rect_x = int(xpos_current_quest - pointer_w / 2)
    rect_y = int(Y_QUEST_CIRCLE - 1.9 * QUEST_CIRCLE_R)
    pg.draw.rect(bg, darkGray, [rect_x, rect_y, pointer_w, pointer_h])
    bg.blit(img['pointer'], (int(xpos_next_quest - pointer_w/2), 
                          int(Y_QUEST_CIRCLE - 1.9 * QUEST_CIRCLE_R)))
    screen.blit(bg, (0, 0))
    pg.display.flip()


# Updates all relevant info when a quest is completed
def quest_stamp(i):
    global quest_count
    if event.key == pg.K_s:
        circle_color_overlay(X_QUEST_CIRCLE[i], Y_QUEST_CIRCLE, QUEST_CIRCLE_R, blueMark)
        freeze_quest_timer()
        quest_success()
        display_score()
        quest_count += 1
    if event.key == pg.K_f:
        circle_color_overlay(X_QUEST_CIRCLE[i], Y_QUEST_CIRCLE, QUEST_CIRCLE_R, redMark)
        freeze_quest_timer()
        quest_fail()
        display_score()
        quest_count += 1


def vote_stamp(xpos):
    global vote_count
    circle_color_overlay(xpos, Y_VOTE_CIRCLE, TIMER_CIRCLE_R, redMark) 
    vote_count += 1


def clocks_increase():
    global total_seconds, total_minutes, total_hours
    global quest_seconds, quest_minutes, total_hours
    total_seconds = total_seconds + 1
    if total_seconds == 60:
        total_minutes = total_minutes + 1
        total_seconds = 0
    quest_seconds = quest_seconds + 1
    if quest_seconds == 60:
        quest_minutes = quest_minutes + 1
        quest_seconds = 0


def total_timer():
    xpos = int(resx / 12 * 11.1)
    ypos = int(resy / 12 * 10.5)

    draw_circle(bg, xpos, ypos, QUEST_CIRCLE_R, darkerGray)  # outer ring of total timer circle
    draw_circle(bg, xpos, ypos, int(QUEST_CIRCLE_R - 0.07 * QUEST_CIRCLE_R), lightGray)

    font = pg.font.SysFont("Calibri", 28)
    text = font.render('Total time', 1, darkestGray)
    textpos = text.get_rect(center=(xpos, ypos - TIMER_CIRCLE_R // 2))
    bg.blit(text, textpos)

    font = pg.font.SysFont("Calibri", 48)
    text = font.render("{0:02}".format(total_minutes), 1, darkestGray)  # zero-pad Minutes to 2 digits
    textpos = text.get_rect(center=(xpos - QUEST_CIRCLE_R//3, ypos + TIMER_CIRCLE_R // 2.35))
    bg.blit(text, textpos)

    text = font.render(":{0:02}".format(total_seconds), 1, darkestGray)
    textpos = text.get_rect(center=(xpos + QUEST_CIRCLE_R//3, ypos + TIMER_CIRCLE_R // 2.35))
    bg.blit(text, textpos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def start_quest_timer(quest_count):
    font = pg.font.SysFont("Trebuchet MS", 26)
    # Background circle
    draw_circle(bg, X_TIMER_CIRCLE[quest_count], Y_TIMER_CIRCLE, TIMER_CIRCLE_R, darkerGray) # outer ring
    draw_circle(bg, X_TIMER_CIRCLE[quest_count], Y_TIMER_CIRCLE, int(TIMER_CIRCLE_R - 0.07 * TIMER_CIRCLE_R), lightGray) # inner ring
    # quest_minutes
    text = font.render("{0:02}".format(quest_minutes), 1, darkerGray)  # zero-pad Minutes to 2 digits
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[quest_count] - 18, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    # quest_seconds
    text = font.render(":{0:02}".format(quest_seconds), 1, darkerGray)
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[quest_count] + 15, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()
    total_timer()


def freeze_quest_timer():
    global quest_seconds, quest_minutes
    font = pg.font.SysFont("Trebuchet MS", 26)
    draw_circle(bg, X_TIMER_CIRCLE[quest_count], Y_TIMER_CIRCLE, TIMER_CIRCLE_R, darkGray) # outer ring
    draw_circle(bg, X_TIMER_CIRCLE[quest_count], Y_TIMER_CIRCLE, int(TIMER_CIRCLE_R - 0.1 * TIMER_CIRCLE_R), lightGray)
    # quest_minutes
    text = font.render("{0:02}".format(quest_minutes), 1, darkerGray)  # zero-pad Minutes to 2 digits
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[quest_count] - 18, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    # quest_seconds
    text = font.render(":{0:02}".format(quest_seconds), 1, darkerGray)
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[quest_count] + 15, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()
    quest_seconds = 0
    quest_minutes = 0


def player_box():
    display_w = int((GAME_BOARD_H / GOLDEN_RATIO)/2)    # if changing value, check assassination function
    display_h = int(1.4 * QUEST_CIRCLE_R)  # if changing value, check assassination function
    display_w2 = int(display_w - 0.5 * TIMER_CIRCLE_R)
    display_h2 = int(display_h - 0.5 * TIMER_CIRCLE_R)

    pg.gfxdraw.box(bg, [int(resx - ((resx - GAME_BOARD_W) / 2) - display_w),
                        int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R), display_w, display_h], lightGray)
    pg.gfxdraw.box(bg, [int(resx - ((resx - GAME_BOARD_W) / 2) - display_w + (display_h - display_h2)/2),
                        int((resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R)
                            + (display_h - display_h2)/2), display_w2, display_h2], lighterGray)
    screen.blit(bg, (0, 0))
    font = pg.font.Font('fonts/Enchanted Land.otf', 45)
    minion_amount = int(player_amount / 0.58 / 4) # somehow math works
    text = font.render(str(minion_amount) + ' minions', 1, redMark) 
    bg.blit(text, (resx // 1.35, int(resy - ((resy - GAME_BOARD_H) / 2) - 1.8 * QUEST_CIRCLE_R)))
    text = font.render(str(player_amount - minion_amount) + ' loyal servants', 1, blueMark)
    bg.blit(text, (resx // 1.415, int(resy - ((resy - GAME_BOARD_H) / 2) - 2.2 * QUEST_CIRCLE_R)))
    pg.display.flip()  # Shows amount of players


def display_msg(msg):
    display_msg_x = resx / 2
    display_msg_y = 320
    #   FIX THESE VALUES SO THEY WORK ON DIFFERENT RESOLUTIONS
    font = pg.font.Font('fonts/CATFranken-Deutsch.ttf', 36)
    text = font.render(msg, 1, darkerGray)
    textpos = text.get_rect(center=(display_msg_x, display_msg_y))
    textwidth = text.get_rect().width
    scrollw = img['leftscroll'].get_rect().width  # 592
    scrollh = img['leftscroll'].get_rect().height  # 425
    display_h = scrollh - 19
    display_w = textwidth - 60
    leftscroll_xpos = resx / 2 - scrollw / 2 - display_w / 2 + 5
    rightscroll_xpos = resx / 2 - scrollw / 2 + display_w / 2 - 5
    scroll_ypos = 272
    pg.gfxdraw.box(bg, [display_msg_x - display_w / 2, display_msg_y - display_h / 2, display_w, display_h], yellowishWhite)
    bg.blit(img['leftscroll'], (leftscroll_xpos, scroll_ypos))
    bg.blit(img['rightscroll'], (rightscroll_xpos, scroll_ypos))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_corner_ribbons():
    boxw = 250
    boxh = 125
    w = img['cornerribbonblue'].get_rect().width  # 94
    h = img['pointer'].get_rect().height  # 94
    bg.blit(img['cornerribbonblue'], [int(resx / 12 - boxw / 2 - 7), int(resy / 12 * 11 - boxh / 2 - 7)])
    bg.blit(img['cornerribbonred'], [int(resx / 12 - boxw / 2 + boxw - w + 7), int(resy / 12 * 11- boxh / 2) - 7])
    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_two_fails_required():
    bg.blit(img['twofailsreq'], (X_QUEST_CIRCLE[3] - QUEST_CIRCLE_R - 13, Y_QUEST_CIRCLE - QUEST_CIRCLE_R - 27))


def display_score():
    boxw = 250
    boxh = 125
    pg.draw.rect(bg, darkGray, [int(resx / 12 - boxw / 2), int(resy / 12 * 11 - boxh / 2), boxw, boxh])
    font = pg.font.SysFont("Calibri", 110)
    text = font.render('-', 1, lightestGray)  # hyphen
    textpos = text.get_rect(center=(resx // 12, resy // 12 * 11))
    bg.blit(text, textpos)
    text = font.render(str(success_count), 1, blueMark)  # good points
    textpos = text.get_rect(center=(resx // 12 - boxw / 4, resy // 12 * 11.05))
    bg.blit(text, textpos)
    text = font.render(str(fail_count), 1, redMark)  # evil points
    textpos = text.get_rect(center=(resx // 12 + boxw / 4, resy // 12 * 11.05))
    bg.blit(text, textpos)
    display_corner_ribbons()
    screen.blit(bg, (0, 0))
    pg.display.flip()


def esq_quits(event):
    if event.key == K_ESCAPE:
        quit()


def clear_board_bottom():
    pg.draw.rect(bg, darkGray, [380, 670, 950, 230])  # this is to wipe the bottom text area

def voting_phase_func():
    global voting_phase, vote_count
    if vote_count == 5:
        evil_wins() 
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esq_quits(event)
    else:
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esq_quits(event)
                if event.key == pg.K_s:
                    voting_phase = False
                    draw_vote_circle()
                    vote_count = 0
                elif event.key == pg.K_f:
                    vote_stamp(X_VOTE_CIRCLE[vote_count])
                    voting_phase = True
            if event.type == clock_tick:
                clocks_increase()
        start_quest_timer(quest_count)

def assassination():
    clear_board_bottom()
    playerboxw = int((GAME_BOARD_H / GOLDEN_RATIO) / 2)
    playerboxh = int(1.4 * QUEST_CIRCLE_R)
    font = pg.font.Font('fonts/Enchanted Land.otf', 60)
    text1 = font.render(('Keep your Character cards hidden.'), 1, lightestGray)
    text1pos = text1.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R + playerboxh / 4)))
    text2 = font.render(('Assassin may reveal their card and choose a target.'), 1, lightestGray)
    text2pos = text2.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R + playerboxh)))
    bg.blit(text1, text1pos)
    bg.blit(text2, text2pos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def good_wins():
    clear_board_bottom()
    playerboxw = int((GAME_BOARD_H / GOLDEN_RATIO) / 2)
    playerboxh = int(1.4 * QUEST_CIRCLE_R)
    font = pg.font.Font('fonts/Enchanted Land.otf', 160)
    text = font.render(('Goodness prevails!'), 1, blueMark)
    textpos = text.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R + playerboxh / 2)))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def evil_wins():
    clear_board_bottom()
    playerboxw = int((GAME_BOARD_H / GOLDEN_RATIO) / 2)
    playerboxh = int(1.4 * QUEST_CIRCLE_R)
    font = pg.font.Font('fonts/Enchanted Land.otf', 160)
    text = font.render('Evil triumphs!', 1, redMark)
    textpos = text.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R + playerboxh / 2)))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()

################### INITIALIZING DEFAULT VALUES FOR GAME RELATED VARIABLES ################### 
player_amount = 5 # the default value displayed
quest_players = [2, 3, 2, 3, 3]
quest_count = 0
success_count = 0
fail_count = 0
vote_count = 0

night = False
main_menu = True
welcome_screen_initialized = False

######################### THIS IS WHERE THINGS HAPPEN ##################################

display_game_board()
# ensures a maximum of 60 frames per second, RELATED TO TIMER (move elsewhere?)
Clock.tick(60)  

# Start of the game. Choose number of players and press enter to move to "Night phase"
while main_menu:
    if not welcome_screen_initialized:
        display_welcome_screen()
        welcome_screen_initialized = True
    player_count_selection()
    display_player_count()

# "Close your eyes and form a fist..."
while night:
    night_phase()
    for event in pg.event.get():
        if event.type == pg.KEYDOWN:
            if event.key == K_RETURN:
                clear_board()
                pg.display.flip()
                night = False
            esq_quits(event)

# Main screen begins
display_quest_bg(quest_players)

# Add text "2 fails required"
if player_amount > 6:
    display_two_fails_required()

player_box()
display_msg(random_quote)
place_pointer(X_QUEST_CIRCLE[0])
display_score()
display_corner_ribbons()
ass_phase = True    # this is just to activate assassination later


game_running = True
voting_phase = True


while game_running:
    if voting_phase and success_count < 3 and fail_count < 3:
        voting_phase_func()
    else:
        if quest_count in [0, 1, 2]:
                for event in pg.event.get():
                    if event.type == pg.KEYDOWN:
                        quest_stamp(quest_count)
                        esq_quits(event)
                        if event.key == pg.K_s or event.key == pg.K_f:
                            move_pointer(X_QUEST_CIRCLE[quest_count-1], X_QUEST_CIRCLE[quest_count])
                            voting_phase = True
                    if event.type == clock_tick:
                        clocks_increase()
                    start_quest_timer(quest_count)

        elif quest_count == 3 and success_count < 3 and fail_count < 3:
            for event in pg.event.get():
                if event.type == pg.KEYDOWN:
                    quest_stamp(quest_count)
                    esq_quits(event)
                    if event.key == pg.K_s or event.key == pg.K_f:
                        move_pointer(X_QUEST_CIRCLE[quest_count-1], X_QUEST_CIRCLE[quest_count])
                        voting_phase = True
                if event.type == clock_tick:
                    clocks_increase()
                start_quest_timer(quest_count)
                # avoid messing up text under moving quest marker
                if player_amount > 6:
                    display_two_fails_required()

        elif quest_count == 4 and success_count < 3 and fail_count < 3:
            for event in pg.event.get():
                if event.type == pg.KEYDOWN:
                    quest_stamp(quest_count)
                    esq_quits(event)
                if event.type == clock_tick:
                    clocks_increase()

    if success_count == 3 and ass_phase is True and fail_count < 3:
        assassination()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esq_quits(event)
                if event.key == pg.K_g:
                    ass_phase = False
                elif event.key == pg.K_e:
                    fail_count = 3
            if event.type == clock_tick:
                clocks_increase()
                total_timer()
    elif success_count == 3 and ass_phase is False and main_menu is False:
        good_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esq_quits(event)
    elif fail_count == 3:
        evil_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esq_quits(event)

