import random
import time
import os
import threading, queue # for playing music independently of the main loop
import pygame as pg
import pygame.gfxdraw
from pygame.locals import *
from modules import screen_utils, image_utils
from modules import c1 # color palette 1


#### INITIALIZING PYGAME
pg.init()

#### SOUNDS AND MUSIC
pg.mixer.music.set_volume(0.10)

#### SCREEN

#pg.display.set_mode((screen.get_width(), screen.get_height()), pg.RESIZABLE)
resx = 1920  # screen width
resy = 1080  # screen height
reference_resolution = (1920, 1080)
screen = screen_utils.initialize_screen(resx, resy)

#### LOADING IMAGES
img = image_utils.load_images()
bg = img['castlewall']

#### DEFINING COLORS


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
total_secs = 0
total_mins = 0
quest_secs = 0
quest_mins = 0

# QUOTES
quotes_file = "text/quotes.txt"

####### AUDIO #########

current_song = None

def play_sound(file_name):
    file_path = 'sounds/' + file_name
    pg.mixer.music.load(file_path)
    pg.mixer.music.play()
    print('Playing sound: ' + str(file_name))

def play_music(file_name):
    file_path = 'music/' + file_name
    pg.mixer.music.load(file_path)
    pg.mixer.music.play()
    print('Playing song: ' + str(file_name))

def loop_music(folder_name, file_name):
    file_path = 'music/' + folder_name + '/' + file_name
    pg.mixer.music.load(file_path)
    pg.mixer.music.play(-1)
    #print('Looping song: ' + str(file_name))
    print(f'Looping song: [{folder_name}] {file_name}')


# plays random song on loop
def shuffle_folder(folder_name):
    global current_song

    folder_path = 'music/' + folder_name
    if not os.path.exists(folder_path):
        print(f"Error: Folder '{folder_name}' not found in 'music'.")
        return

    mp3_files = [file for file in os.listdir(folder_path) if file.endswith('.mp3')]

    if not mp3_files:
        print(f"No .mp3 files found in '{folder_name}'.")
        return

    random_song = random.choice(mp3_files)
    if len(mp3_files) > 1:
        while random_song == current_song:
            random_song = random.choice(mp3_files)
    current_song = random_song
    #file_path = os.path.join(folder_path, random_song)
    #loop_music2(file_path)
    loop_music(folder_name, random_song)

playlist_for_each_round = ['Round 1', 'Round 2', 'Round 3', 'Round 4']

################### FUNCTIONS #######################

def get_random_quote():
    with open(quotes_file, "r") as file:
        quotes_list = file.readlines()
        return random.choice(quotes_list).strip()
    
random_quote = get_random_quote()


def draw_circle(surface, xpos, ypos, radius, color):
    pg.gfxdraw.filled_circle(surface, xpos, ypos, radius, color)
    pg.gfxdraw.aacircle(surface, xpos, ypos, radius, color) # antialiasing improves the outlines


def display_rounded_rectangle():
    board_x = int(resx / 4.92)
    board_y = int(resy / 5.4)
    board_w = int(resx / 1.684)
    board_h = int(resy / 1.588)
    border_w = int(resx / 64)
    border_h = int(resx / 64) + 1
    border_color = c1.darkGray

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
    pg.draw.rect(bg, c1.darkGray, [int(resx / 4.92), int(resy / 5.4), int(resx / 1.684), int(resy / 1.588)])
    

def display_welcome_screen():
    display_rounded_rectangle()
    linewidth = 850
    clear_board()  # repaints inner rectangle & makes antialiasing look better
    pg.draw.rect(bg, c1.lightWood, (resx // 2 - linewidth // 2, resy // 2.55, linewidth, 2))  # line

    decorative_dots = [
        (resx // 12 * 5, resy // 3 * 2, 10),
        (resx // 12 * 7, resy // 3 * 2, 10),
        (resx // 24 * 9, resy // 3 * 2, 7),
        (resx // 24 * 15, resy // 3 * 2, 7),
        (resx // 12 * 4, resy // 3 * 2, 4),
        (resx // 12 * 8, resy // 3 * 2, 4)
    ]

    for dot in decorative_dots:
        draw_circle(bg, dot[0], dot[1], dot[2], c1.lightWood)

    imgpos = img['welcometoavalon'].get_rect(center=(resx // 2, resy // 3.45))
    bg.blit(img['welcometoavalon'], imgpos)

    pg.font.init()  # Initialize the font system
    font = pg.font.Font('fonts/Enchanted Land.otf', 165)
    text = font.render("How many players?", 1, c1.lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 2.05))
    imgpos = img['howmanyplayers'].get_rect(center=(resx // 2, resy // 2.05))
    bg.blit(img['howmanyplayers'], imgpos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_player_count():
    scrollw = img['verticalscroll'].get_rect().width
    scrollh = img['verticalscroll'].get_rect().height
    scroll_xpos = int(resx * 0.5 - scrollw * 0.5)
    scroll_ypos = int(resy * 0.667 - scrollh * 0.5)
    bg.blit(img['verticalscroll'], (scroll_xpos, scroll_ypos))

    font = pg.font.Font('fonts/Enchanted Land.otf', 180)
    text = font.render(str(player_amount), 1, c1.lightWood)
    textpos = text.get_rect(center=(int(resx * 0.5), int(resy * 0.667)))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def player_count_selection():
    global player_amount, quest_players, main_menu, night_phase

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
            if event.key == K_RETURN:
                night_phase = True
                main_menu = False
            esc_quits(event)
            print('Player amount is: ' + str(player_amount))
        display_player_count()


def display_night_instructions():
    clear_board()
    font = pg.font.Font('fonts/Enchanted Land.otf', 110)
    text = font.render("-  Memorize your Character Card  -", 1, c1.lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3))
    bg.blit(text, textpos)
    font = pg.font.Font('fonts/Enchanted Land.otf', 81)
    text = font.render("-  Close your eyes and form a fist in front of you  -", 1, c1.lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 1.5))
    bg.blit(text, textpos)
    font = pg.font.Font('fonts/Enchanted Land.otf', 110)
    text = font.render("-    Listen for further instructions    -", 1, c1.lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 2))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_circles(players):
    print("Activating function: quest_bg...")
    font = pg.font.Font('fonts/Enchanted Land.otf', 180)
    for i in range(0, 5):
        draw_circle(bg, X_QUEST_CIRCLE[i], Y_QUEST_CIRCLE, QUEST_CIRCLE_R, c1.lighterGray)
        text = font.render(str(players[i]), 1, c1.darkGray)  # player amount text
        textpos = text.get_rect(center=(X_QUEST_CIRCLE[i], Y_QUEST_CIRCLE))
        bg.blit(text, textpos)
        draw_circle(bg, X_TIMER_CIRCLE[i],
                                 Y_TIMER_CIRCLE, TIMER_CIRCLE_R, c1.lightGray)

    draw_vote_circle()
    screen.blit(bg, (0, 0))
    pg.display.flip()


def draw_vote_circle():
    font = pg.font.Font('fonts/Enchanted Land.otf', 70)
    for i in range(0, 5):
        draw_circle(bg, X_VOTE_CIRCLE[i], Y_VOTE_CIRCLE, VOTE_CIRCLE_R, c1.lighterGray)
        text = font.render(str(i+1), 1, c1.darkGray)
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


def place_pointer(quest):
    pointer_w = img['pointer'].get_rect().width # 43
    bg.blit(img['pointer'], (int(X_QUEST_CIRCLE[quest] - pointer_w/2), int(Y_QUEST_CIRCLE - 1.9 * QUEST_CIRCLE_R)))
    screen.blit(bg, (0, 0))
    pg.display.flip()


def move_pointer():
    xpos_current_quest = X_QUEST_CIRCLE[completed_quests - 1]
    xpos_next_quest = X_QUEST_CIRCLE[completed_quests]

    pointer_w = img['pointer'].get_rect().width  # 43
    pointer_h = img['pointer'].get_rect().height  # 71
    rect_x = int(xpos_current_quest - pointer_w / 2)
    rect_y = int(Y_QUEST_CIRCLE - 1.9 * QUEST_CIRCLE_R)
    pg.draw.rect(bg, c1.darkGray, [rect_x, rect_y, pointer_w, pointer_h])
    bg.blit(img['pointer'], (int(xpos_next_quest - pointer_w / 2), 
                             int(Y_QUEST_CIRCLE - 1.9 * QUEST_CIRCLE_R)))
    # this is here so "2 fails req" text isn't cleared by pointer
    if player_amount > 6:
        display_two_fails_required()
    screen.blit(bg, (0, 0))
    pg.display.flip()


# Updates all relevant info when a quest is completed
def mark_quest_done():
    if event.key == pg.K_s:
        circle_color_overlay(X_QUEST_CIRCLE[completed_quests], Y_QUEST_CIRCLE, QUEST_CIRCLE_R, (c1.royalBlueTrans))
        freeze_quest_timer()
        quest_success()
    if event.key == pg.K_f:
        circle_color_overlay(X_QUEST_CIRCLE[completed_quests], Y_QUEST_CIRCLE, QUEST_CIRCLE_R, c1.evilRedTrans)
        freeze_quest_timer()
        quest_fail()

def vote_stamp(xpos):
    global vote_count
    circle_color_overlay(xpos, Y_VOTE_CIRCLE, TIMER_CIRCLE_R, c1.evilRedTrans) 
    vote_count += 1


def clocks_increase():
    global total_secs, total_mins, total_hours
    global quest_secs, quest_mins, total_hours
    total_secs = total_secs + 1
    if total_secs == 60:
        total_mins = total_mins + 1
        total_secs = 0
    quest_secs = quest_secs + 1
    if quest_secs == 60:
        quest_mins = quest_mins + 1
        quest_secs = 0


def update_total_timer():
    xpos = int(resx / 12 * 11.1)
    ypos = int(resy / 12 * 10.5)

    draw_circle(bg, xpos, ypos, QUEST_CIRCLE_R, c1.darkerGray)  # outer ring of total timer circle
    draw_circle(bg, xpos, ypos, int(QUEST_CIRCLE_R - 0.07 * QUEST_CIRCLE_R), c1.lighterGray)

    font = pg.font.SysFont("Calibri", 28)
    text = font.render('Total time', 1, c1.darkestGray)
    textpos = text.get_rect(center=(xpos, ypos - TIMER_CIRCLE_R // 2))
    bg.blit(text, textpos)

    font = pg.font.SysFont("Calibri", 48)
    text = font.render("{0:02}".format(total_mins), 1, c1.darkestGray)  # zero-pad Minutes to 2 digits
    textpos = text.get_rect(center=(xpos - QUEST_CIRCLE_R//3, ypos + TIMER_CIRCLE_R // 2.35))
    bg.blit(text, textpos)

    text = font.render(":{0:02}".format(total_secs), 1, c1.darkestGray)
    textpos = text.get_rect(center=(xpos + QUEST_CIRCLE_R//3, ypos + TIMER_CIRCLE_R // 2.35))
    bg.blit(text, textpos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def update_quest_timer():
    x_offset_mins = int(TIMER_CIRCLE_R * 0.42)
    x_offset_secs = int(TIMER_CIRCLE_R * 0.35)
    font = pg.font.SysFont("Trebuchet MS", 26)
    # Background circle
    draw_circle(bg, X_TIMER_CIRCLE[completed_quests], Y_TIMER_CIRCLE, TIMER_CIRCLE_R, c1.darkestGray) # outer ring
    draw_circle(bg, X_TIMER_CIRCLE[completed_quests], Y_TIMER_CIRCLE, int(TIMER_CIRCLE_R - 0.1 * TIMER_CIRCLE_R), c1.lightGray) # inner ring
    # quest_mins
    text = font.render("{0:02}".format(quest_mins), 1, c1.darkestGray)  # zero-pad Minutes to 2 digits
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[completed_quests] - x_offset_mins, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    # quest_secs
    text = font.render(":{0:02}".format(quest_secs), 1, c1.darkestGray)
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[completed_quests] + x_offset_secs, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def freeze_quest_timer():
    global quest_secs, quest_mins
    font = pg.font.SysFont("Trebuchet MS", 26)
    draw_circle(bg, X_TIMER_CIRCLE[completed_quests], Y_TIMER_CIRCLE, TIMER_CIRCLE_R+1, c1.darkGray) # outer ring
    draw_circle(bg, X_TIMER_CIRCLE[completed_quests], Y_TIMER_CIRCLE, int(TIMER_CIRCLE_R - 0.1 * TIMER_CIRCLE_R), c1.lightGray)
    # quest_mins
    text = font.render("{0:02}".format(quest_mins), 1, c1.darkerGray)  # zero-pad Minutes to 2 digits
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[completed_quests] - 18, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    # quest_secs
    text = font.render(":{0:02}".format(quest_secs), 1, c1.darkerGray)
    textpos = text.get_rect(center=(X_TIMER_CIRCLE[completed_quests] + 15, Y_TIMER_CIRCLE))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()
    quest_secs = 0
    quest_mins = 0


def display_minions_and_servants():
    display_w = int((GAME_BOARD_H / GOLDEN_RATIO)/2)    # if changing value, check assassination function
    display_h = int(1.4 * QUEST_CIRCLE_R)  # if changing value, check assassination function
    display_w2 = int(display_w - 0.5 * TIMER_CIRCLE_R)
    display_h2 = int(display_h - 0.5 * TIMER_CIRCLE_R)

    pg.gfxdraw.box(bg, [int(resx - ((resx - GAME_BOARD_W) / 2) - display_w),
                        int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R), display_w, display_h], c1.lightGray)
    pg.gfxdraw.box(bg, [int(resx - ((resx - GAME_BOARD_W) / 2) - display_w + (display_h - display_h2)/2),
                        int((resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R)
                            + (display_h - display_h2)/2), display_w2, display_h2], c1.lighterGray)
    screen.blit(bg, (0, 0))
    font = pg.font.Font('fonts/Enchanted Land.otf', 45)
    minion_amount = int(player_amount / 0.58 / 4) # somehow math works
    text = font.render(str(minion_amount) + ' minions', 1, c1.evilRed) 
    bg.blit(text, (resx // 1.35, int(resy - ((resy - GAME_BOARD_H) / 2) - 1.8 * QUEST_CIRCLE_R)))
    text = font.render(str(player_amount - minion_amount) + ' loyal servants', 1, c1.royalBlue)
    bg.blit(text, (resx // 1.415, int(resy - ((resy - GAME_BOARD_H) / 2) - 2.2 * QUEST_CIRCLE_R)))
    pg.display.flip()  # Shows amount of players


def display_msg(msg):
    # should add a "clearing" of the area underneath the displayed msg
    display_msg_x = resx // 2
    display_msg_y = int(resy * 0.259)
    #   values need to be coded to work with different resolutions
    font = pg.font.Font('fonts/CATFranken-Deutsch.ttf', 36)
    text = font.render(msg, 1, c1.darkestGray)
    textpos = text.get_rect(center=(display_msg_x, display_msg_y))
    textwidth = text.get_rect().width
    scrollw = img['leftscroll'].get_rect().width  # 592
    scrollh = img['leftscroll'].get_rect().height  # 425
    display_h = scrollh - 19
    display_w = textwidth - 60
    leftscroll_xpos = resx / 2 - scrollw / 2 - display_w / 2 + 5
    rightscroll_xpos = resx / 2 - scrollw / 2 + display_w / 2 - 5
    scroll_ypos = display_msg_y - 48
    pg.gfxdraw.box(bg, [display_msg_x - display_w / 2, display_msg_y - display_h / 2, display_w, display_h], c1.yellowishWhite)
    bg.blit(img['leftscroll'], (leftscroll_xpos, scroll_ypos))
    bg.blit(img['rightscroll'], (rightscroll_xpos, scroll_ypos))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def display_two_fails_required():
    bg.blit(img['twofailsreq'], (X_QUEST_CIRCLE[3] - QUEST_CIRCLE_R - 13, Y_QUEST_CIRCLE - QUEST_CIRCLE_R - 27))


def esc_quits(event):
    if event.key == K_ESCAPE:
        quit()


def clear_board_bottom():
    
    current_resolution = pg.display.get_surface().get_size()
    ratio_x = current_resolution[0] / reference_resolution[0]
    ratio_y = current_resolution[1] / reference_resolution[1]
    
    rect_x = int(380 * ratio_x)
    rect_y = int(670 * ratio_y)
    rect_width = int(950 * ratio_x)
    rect_height = int(230 * ratio_y)
    
    pg.draw.rect(bg, c1.darkGray, [rect_x, rect_y, rect_width, rect_height])


def display_first_board():
    clear_board()
    display_circles(quest_players)
    if player_amount > 6:
        display_two_fails_required()
    display_minions_and_servants()
    display_msg(random_quote)
    place_pointer(quest=0)


def voting_phase_func():
    global voting_phase, vote_count
    if vote_count == 5:
        evil_wins() 
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                if event.key == K_ESCAPE:
                    esc_quits(event)
    else:
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits(event)
                if event.key == pg.K_s:
                    voting_phase = False
                    draw_vote_circle()
                    vote_count = 0
                elif event.key == pg.K_f:
                    vote_stamp(X_VOTE_CIRCLE[vote_count])
                    voting_phase = True
            if event.type == clock_tick:
                update_quest_timer()
                update_total_timer()
                clocks_increase()
        


def display_assassination_instructions():
    clear_board_bottom()
    playerboxw = int((GAME_BOARD_H / GOLDEN_RATIO) / 2)
    playerboxh = int(1.4 * QUEST_CIRCLE_R)
    font = pg.font.Font('fonts/Enchanted Land.otf', 60)
    text1 = font.render(('Keep your Character cards hidden.'), 1, c1.lighterWood)
    text1pos = text1.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R + playerboxh / 4)))
    text2 = font.render(('Assassin may reveal their card and choose a target.'), 1, c1.lighterWood)
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
    text = font.render(('Goodness prevails!'), 1, c1.royalBlue)
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
    text = font.render('Evil triumphs!', 1, c1.evilRed)
    textpos = text.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - GAME_BOARD_H) / 2) - 2.4 * QUEST_CIRCLE_R + playerboxh / 2)))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()

################### INITIALIZING DEFAULT VALUES FOR GAME RELATED VARIABLES ################### 

player_amount = 8 # the default value displayed
quest_players = [3, 4, 4, 5, 5]
completed_quests = 0
success_count = 0
fail_count = 0
vote_count = 0

night_phase = False

welcome_screen_initialized = False
night_phase_initialized = False
assassination_instructions_initialized = False
voting_phase_music_initialized = False

assassin_phase = True    # this is just to activate assassination later
Merlin = 'alive'

music = None

######################### MAIN LOOPS ##################################

# Start of the game. Choose number of players and press enter to move to "Night phase"
main_menu = True
while main_menu:
    if not welcome_screen_initialized:
        display_welcome_screen()
        shuffle_folder('Main menu')
        welcome_screen_initialized = True
    if not pygame.mixer.music.get_busy():
        shuffle_folder('FOOBAR')
    player_count_selection()
    Clock.tick(60)  

# "Close your eyes and form a fist..."
while night_phase:
    if not night_phase_initialized:
        display_night_instructions()
        shuffle_folder('Night phase')
        night_phase_initialized = True
    for event in pg.event.get():
        if event.type == pg.KEYDOWN:
            if event.key == K_RETURN:
                night_phase = False
                
            esc_quits(event)
    Clock.tick(60)  

# Main game begins
display_first_board()

main_game = True
voting_phase = True
while main_game:
    
    # Nominating and voting on teams
    if voting_phase and success_count < 3 and fail_count < 3:
        voting_phase_func()
        if not voting_phase_music_initialized:
            shuffle_folder(playlist_for_each_round[completed_quests])
            voting_phase_music_initialized = True

    # Picking quest cards and telling a story
    else:
        if completed_quests in [0, 1, 2, 3] and success_count < 3 and fail_count < 3:

            for event in pg.event.get():
                if event.type == pg.KEYDOWN:
                    esc_quits(event)
                    if event.key == pg.K_s or event.key == pg.K_f:
                        mark_quest_done()
                        completed_quests += 1
                        move_pointer()
                        voting_phase_music_initialized = False
                        voting_phase = True
                    print('completed_quests = ' + str(completed_quests))
                    print('success_count = ' + str(success_count))
                    print('fail_count = ' + str(fail_count))
                if event.type == clock_tick:
                    clocks_increase()
                update_quest_timer()
                update_total_timer()

        elif completed_quests == 4 and success_count < 3 and fail_count < 3:
            for event in pg.event.get():
                if event.type == pg.KEYDOWN:
                    esc_quits(event)
                    if event.key == pg.K_s or event.key == pg.K_f:
                        mark_quest_done()
                        completed_quests += 1
                    print('completed_quests = ' + str(completed_quests))
                    print('success_count = ' + str(success_count))
                    print('fail_count = ' + str(fail_count))
                if event.type == clock_tick:
                    clocks_increase()
    
    # ASSASSINATION
    if success_count == 3 and assassin_phase is True:
        if not assassination_instructions_initialized:
            display_assassination_instructions()
            assassination_instructions_initialized = True
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits(event)
                if event.key == pg.K_g:
                    print('pressed g')
                    assassin_phase = False
                elif event.key == pg.K_e:
                    print('pressed e')
                    Merlin = 'dead'
                    assassin_phase = False
            if event.type == clock_tick:
                clocks_increase()
            update_total_timer()

        if music != 'Assassination':
            play_music('Cornelius Link - Astronomia - Medieval Style.mp3')
            music = 'Assassination'
          
    # GOOD VICTORY
    elif success_count == 3 and assassin_phase is False and Merlin == 'alive':
        good_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits(event)
                # THIS ISN'T WORKING
                if event.key == K_RETURN:
                    welcome_screen_initialized = False
                    main_menu = True

    # EVIL WINS BY THREE FAILED QUESTS
    elif fail_count == 3:
        evil_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits(event)
    # EVIL WINS BY ASSASSINATING MERLIN
    elif Merlin == 'dead':
        evil_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits(event)

    Clock.tick(60)

