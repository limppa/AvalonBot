import ctypes
import os
import random
import time

import pygame as pg
import pygame.gfxdraw
from pygame.locals import *


def success_sound():
    pg.mixer.music.load('success.mp3')
    pg.mixer.music.play()


def fail_sound():
    pg.mixer.music.load('fail.mp3')
    pg.mixer.music.play()


def game_board():  # ROUNDED RECTANGLE
    pg.draw.rect(bg, darkGray,
                 [int(resx / 4.92), int(resy / 5.4), int(resx / 1.684), int(resy / 1.588)])  # mid part of board
    # (390,200,1140,680)
    pg.draw.rect(bg, darkGray, [int(resx / 5.33), int(resy / 5.4), int(resx / 64), int(resy / 1.588)])  # left border
    # (360, 200, 30, 680)
    pg.draw.rect(bg, darkGray,
                 [int(resx / 1.2549), int(resy / 5.4), int(resx / 64) + 1, int(resy / 1.588)])  # right border
    # (1530, 200, 31, 680)
    pg.draw.rect(bg, darkGray,
                 [int(resx / 4.92), int(resy / 6.35), int(resx / 1.684), int(resx / 64) + 1])  # top border
    # (390, 170, 1140, 31)
    pg.draw.rect(bg, darkGray,
                 [int(resx / 4.92), int(resy / 1.227), int(resx / 1.684), int(resx / 64) + 1])  # bottom border
    # (390, 880, 1140, 31)
    pg.gfxdraw.filled_circle(bg, int(resx / 4.92), int(resy / 5.4), int(resx / 64), darkGray)  # top left rounding
    pg.gfxdraw.aacircle(bg, int(resx / 4.92), int(resy / 5.4), int(resx / 64), darkGray)
    # (390, 200, 30)
    pg.gfxdraw.filled_circle(bg, int(resx / 1.2549), int(resy / 5.4), int(resx / 64), darkGray)  # top right rounding
    pg.gfxdraw.aacircle(bg, int(resx / 1.2549), int(resy / 5.4), int(resx / 64), darkGray)
    # (1530, 200, 30)
    pg.gfxdraw.filled_circle(bg, int(resx / 4.92), int(resy / 1.227), int(resx / 64), darkGray)  # bottom left rounding
    pg.gfxdraw.aacircle(bg, int(resx / 4.92), int(resy / 1.227), int(resx / 64), darkGray)
    # (390, 880, 30)
    pg.gfxdraw.filled_circle(bg, int(resx / 1.2549), int(resy / 1.227), int(resx / 64),
                             darkGray)  # bottom right rounding
    pg.gfxdraw.aacircle(bg, int(resx / 1.2549), int(resy / 1.227), int(resx / 64), darkGray)
    # 1530, 880, 30)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def wipe_board():
    pg.draw.rect(bg, darkGray, [int(resx / 4.92), int(resy / 5.4), int(resx / 1.684), int(resy / 1.588)])
    # used for clearing the board


def welcome_screen():
    linewidth = 850
    outsideboxwidth = 140
    outsideboxheight = 165
    insideboxwidth = 120
    insideboxheight = 145
    wipe_board()  # this repaints the inner rectangle which makes the antialiasing look better
    pg.draw.rect(bg, lightWood, (resx // 2 - linewidth // 2, resy // 2.55, linewidth, 2))  # line

    pg.gfxdraw.aacircle(bg, resx // 12 * 5, resy // 3 * 2, 10, lightWood)  # these are the decorative dots
    pg.gfxdraw.filled_circle(bg, resx // 12 * 5, resy // 3 * 2, 10, lightWood)
    pg.gfxdraw.aacircle(bg, resx // 12 * 7, resy // 3 * 2, 10, lightWood)
    pg.gfxdraw.filled_circle(bg, resx // 12 * 7, resy // 3 * 2, 10, lightWood)
    pg.gfxdraw.aacircle(bg, resx // 24 * 9, resy // 3 * 2, 7, lightWood)
    pg.gfxdraw.filled_circle(bg, resx // 24 * 9, resy // 3 * 2, 7, lightWood)
    pg.gfxdraw.aacircle(bg, resx // 24 * 15, resy // 3 * 2, 7, lightWood)
    pg.gfxdraw.filled_circle(bg, resx // 24 * 15, resy // 3 * 2, 7, lightWood)
    pg.gfxdraw.aacircle(bg, resx // 12 * 4, resy // 3 * 2, 4, lightWood)
    pg.gfxdraw.filled_circle(bg, resx // 12 * 4, resy // 3 * 2, 4, lightWood)
    pg.gfxdraw.aacircle(bg, resx // 12 * 8, resy // 3 * 2, 4, lightWood)
    pg.gfxdraw.filled_circle(bg, resx // 12 * 8, resy // 3 * 2, 4, lightWood)  # these are the decorative dots

    font = pg.font.Font('Enchanted Land.otf', 200)
    text = font.render("Welcome to Avalon", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3))
    bg.blit(welcometoavalon, textpos)

    font = pg.font.Font('Enchanted Land.otf', 165)
    text = font.render("How many players?", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 1.95))
    bg.blit(howmanyplayers, textpos)

    scrollw = verticalscroll.get_rect().width
    scrollh = verticalscroll.get_rect().height
    scrollposx = resx / 2 - scrollw / 2
    scrollposy = resy // 3 * 2 - scrollh / 2
    bg.blit(verticalscroll, (scrollposx, scrollposy))

    font = pg.font.Font('Enchanted Land.otf', 180)
    text = font.render(str(player_amount), 1, lightWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 2))
    bg.blit(text, textpos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def night_phase():
    wipe_board()
    font = pg.font.Font('Enchanted Land.otf', 110)
    text = font.render("-  Memorize your Character Card  -", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3))
    bg.blit(text, textpos)
    font = pg.font.Font('Enchanted Land.otf', 81)
    text = font.render("-  Close your eyes and form a fist in front of you  -", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 1.5))
    bg.blit(text, textpos)
    font = pg.font.Font('Enchanted Land.otf', 110)
    text = font.render("-    Listen for further instructions    -", 1, lighterWood)
    textpos = text.get_rect(center=(resx // 2, resy // 3 * 2))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def quest_bg(players):

    # Draw quest circles
    font = pg.font.Font('Enchanted Land.otf', 180)
    for qcircle in range(0, 5):
        pg.gfxdraw.filled_circle(bg, qx_pos[qcircle], qy_b, questCircleR, lighterGray)
        pg.gfxdraw.aacircle(bg, qx_pos[qcircle], qy_b, questCircleR, lighterGray)
        text = font.render(str(players[qcircle]), 1, darkGray)  # Q1 player amount
        textpos = text.get_rect(center=(qx_pos[qcircle], qy_b))
        bg.blit(text, textpos)
        pg.gfxdraw.filled_circle(bg, qx_pos[qcircle] + timerCircleOffset,
                                 qy2, timerCircleR, lightGray)
        pg.gfxdraw.aacircle(bg, qx_pos[qcircle] + timerCircleOffset,
                            qy2, timerCircleR, lightGray)

    draw_vote()

    screen.blit(bg, (0, 0))
    pg.display.flip()


def draw_vote():
    # Draw voting circles
    font = pg.font.Font('Enchanted Land.otf', 70)
    for vcircle in range(0, 5):
        pg.gfxdraw.filled_circle(bg, vote_pos[vcircle], qy_v, timerCircleR, lighterGray)
        pg.gfxdraw.aacircle(bg, vote_pos[vcircle], qy_v, timerCircleR, lighterGray)
        text = font.render(str(vcircle+1), 1, darkGray)
        textpos = text.get_rect(center=(vote_pos[vcircle], qy_v))
        bg.blit(text, textpos)


def highlight_quest(qx, players):

    font = pg.font.Font('Enchanted Land.otf', 180)

    pg.gfxdraw.filled_circle(bg, qx, qy_b, questCircleR, lightestGray)  # big circle Q1
    pg.gfxdraw.aacircle(bg, qx, qy_b, questCircleR, lightestGray)
    text = font.render(str(players[0]), 1, darkGray)  # Q1 player amount
    textpos = text.get_rect(center=(qx, qy_b))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()
    #  not in use currently


def marker(qx, qy, mark, radius):
    pg.gfxdraw.aacircle(bg, qx, qy, radius, mark)
    pg.gfxdraw.filled_circle(bg, qx, qy, radius, mark)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def quest_fail():
    global fail_count
    fail_count += 1
    fail_sound()


def quest_success():
    global success_count
    success_count += 1
    success_sound()


def place_pointer(qx):
    pointerw = pointer.get_rect().width  # 43
    pointerh = pointer.get_rect().height  # 71

    bg.blit(pointer, (int(qx - pointerw/2), int(qy_b - 1.9 * questCircleR)))
    screen.blit(bg, (0, 0))
    pg.display.flip()


def clear_pointers():
    pointerw = pointer.get_rect().width  # 43
    pointerh = pointer.get_rect().height  # 71

    for position in range(0, 5):
        pg.draw.rect(bg, darkGray, [int(qx_pos[position] - pointerw/2),
                                    int(qy_b - 1.9 * questCircleR), pointerw, pointerh])

    screen.blit(bg, (0, 0))
    pg.display.flip()


def move_pointer(qx, nextquest):
    pointerw = pointer.get_rect().width  # 43
    pointerh = pointer.get_rect().height  # 71
    pg.draw.rect(bg, darkGray, [int(qx - pointerw/2), int(qy_b - 1.9 * questCircleR), pointerw, pointerh])
    bg.blit(pointer, (int(nextquest - pointerw/2), int(qy_b - 1.9 * questCircleR)))
    screen.blit(bg, (0, 0))
    pg.display.flip()


# The quest_stamp function updates all relevant info when a quest is completed
def quest_stamp(qx):
    global quest_count
    if event.key == pg.K_s:
        marker(qx, qy_b, blueMark, questCircleR)
        freeze_quest_timer(qx)
        quest_success()
        display_score()
        quest_count += 1
    if event.key == pg.K_f:
        marker(qx, qy_b, redMark, questCircleR)
        freeze_quest_timer(qx)
        quest_fail()
        display_score()
        quest_count += 1


def vote_stamp(qx):
    global vote_count
    marker(qx, qy_v, redMark, timerCircleR)
    vote_count += 1


def clocks_increase():
    global TotalSeconds, TotalMinutes, TotalHours
    global QuestSeconds, QuestMinutes, TotalHours
    TotalSeconds = TotalSeconds + 1
    if TotalSeconds == 60:
        TotalMinutes = TotalMinutes + 1
        TotalSeconds = 0
    QuestSeconds = QuestSeconds + 1
    if QuestSeconds == 60:
        QuestMinutes = QuestMinutes + 1
        QuestSeconds = 0


def total_timer():
    posx = int(resx / 12 * 11.1)
    posy = int(resy / 12 * 10.5)

    pg.gfxdraw.filled_circle(bg, posx, posy, questCircleR, darkerGray)  # outer ring of total timer circle
    pg.gfxdraw.aacircle(bg, posx, posy, questCircleR, darkerGray)
    pg.gfxdraw.filled_circle(bg, posx, posy, int(questCircleR - 0.07 * questCircleR), lightGray)
    pg.gfxdraw.aacircle(bg, posx, posy, int(questCircleR - 0.07 * questCircleR), lightGray)

    font = pg.font.SysFont("Calibri", 28)

    text = font.render('Total time', 1, darkestGray)
    textrect = text.get_rect()
    textrect.center = (posx, posy - timerCircleR // 2)
    bg.blit(text, textrect)

    font = pg.font.SysFont("Calibri", 48)
    # TotalMinutes
    minutestext = font.render("{0:02}".format(TotalMinutes), 1, darkestGray)  # zero-pad Minutes to 2 digits
    minutestextrect = minutestext.get_rect()
    minutestextrect.center = (posx - questCircleR//3, posy + timerCircleR // 2.35)
    bg.blit(minutestext, minutestextrect)
    # QuestSeconds
    secondstext = font.render(":{0:02}".format(TotalSeconds), 1, darkestGray)
    secondstextrect = secondstext.get_rect()
    secondstextrect.center = (posx + questCircleR//3, posy + timerCircleR // 2.35)
    bg.blit(secondstext, secondstextrect)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def quest_timer(qx):
    font = pg.font.SysFont("Trebuchet MS", 26)
    # Background circle
    pg.gfxdraw.filled_circle(bg, qx + timerCircleOffset, qy2, timerCircleR, darkerGray)     # outer ring
    pg.gfxdraw.aacircle(bg, qx + timerCircleOffset, qy2, timerCircleR, darkerGray)
    pg.gfxdraw.filled_circle(bg, qx + timerCircleOffset, qy2, int(timerCircleR - 0.07 * timerCircleR), lightGray)
    pg.gfxdraw.aacircle(bg, qx + timerCircleOffset, qy2, int(timerCircleR - 0.07 * timerCircleR), lightGray)
    # QuestMinutes
    minutestext = font.render("{0:02}".format(QuestMinutes), 1, darkestGray)  # zero-pad Minutes to 2 digits
    minutestextrect = minutestext.get_rect()
    minutestextrect.center = (qx + timerCircleOffset - 18, qy2)
    bg.blit(minutestext, minutestextrect)
    # QuestSeconds
    secondstext = font.render(":{0:02}".format(QuestSeconds), 1, darkestGray)
    secondstextrect = secondstext.get_rect()
    secondstextrect.center = (qx + timerCircleOffset + 15, qy2)
    bg.blit(secondstext, secondstextrect)
    screen.blit(bg, (0, 0))
    pg.display.flip()
    total_timer()


def freeze_quest_timer(qx):
    global QuestSeconds, QuestMinutes
    font = pg.font.SysFont("Trebuchet MS", 26)
    pg.gfxdraw.filled_circle(bg, qx + timerCircleOffset, qy2, timerCircleR, darkGray)     # outer ring
    pg.gfxdraw.aacircle(bg, qx + timerCircleOffset, qy2, timerCircleR, darkGray)
    pg.gfxdraw.filled_circle(bg, qx + timerCircleOffset, qy2, int(timerCircleR - 0.1 * timerCircleR), lightGray)
    pg.gfxdraw.aacircle(bg, qx + timerCircleOffset, qy2, int(timerCircleR - 0.1 * timerCircleR), lightGray)
    # QuestMinutes
    minutestext = font.render("{0:02}".format(QuestMinutes), 1, darkerGray)  # zero-pad Minutes to 2 digits
    minutestextrect = minutestext.get_rect()
    minutestextrect.center = (qx + timerCircleOffset - 18, qy2)
    bg.blit(minutestext, minutestextrect)
    # QuestSeconds
    secondstext = font.render(":{0:02}".format(QuestSeconds), 1, darkerGray)
    secondstextrect = secondstext.get_rect()
    secondstextrect.center = (qx + timerCircleOffset + 15, qy2)
    bg.blit(secondstext, secondstextrect)
    screen.blit(bg, (0, 0))
    pg.display.flip()
    QuestSeconds = 0
    QuestMinutes = 0


def player_box():
    displayh = int(1.4 * questCircleR)  # if changing value, check assassination function
    displayw = int((game_boardH / goldenratio)/2)    # if changing value, check assassination function
    displayw2 = int(displayw - 0.5 * timerCircleR)
    displayh2 = int(displayh - 0.5 * timerCircleR)

    pg.gfxdraw.box(bg, [int(resx - ((resx - game_boardW) / 2) - displayw),
                        int(resy - ((resy - game_boardH) / 2) - 2.4 * questCircleR), displayw, displayh], lightGray)
    pg.gfxdraw.box(bg, [int(resx - ((resx - game_boardW) / 2) - displayw + (displayh - displayh2)/2),
                        int((resy - ((resy - game_boardH) / 2) - 2.4 * questCircleR)
                            + (displayh - displayh2)/2), displayw2, displayh2], lighterGray)
    screen.blit(bg, (0, 0))
    font = pg.font.Font('Enchanted Land.otf', 45)
    text = font.render(str(player_amount) + ' players', 1, darkerGray)
    bg.blit(text, (resx // 1.41, int(resy - ((resy - game_boardH) / 2) - 2.2 * questCircleR)))
    text = font.render(str(int(player_amount / 0.58 / 4)) + ' minions', 1, darkGray)    # somehow this works
    bg.blit(text, (resx // 1.35, int(resy - ((resy - game_boardH) / 2) - 1.8 * questCircleR)))
    pg.display.flip()  # Shows amount of players


def display_msg(something):
    #   FIX THESE VALUES SO THEY WORK ON DIFFERENT RESOLUTIONS
    font = pg.font.Font('CATFranken-Deutsch.ttf', 36)
    text = font.render(something, 1, darkerGray)
    textpos = text.get_rect(center=(display_msg_x, display_msg_y))

    textwidth = text.get_rect().width
    scrollw = left_scroll.get_rect().width  # 592
    scrollh = left_scroll.get_rect().height  # 425
    displayh = scrollh - 19
    displayw = textwidth - 60
    leftscrollposx = resx / 2 - scrollw / 2 - displayw / 2 + 5
    rightscrollposx = resx / 2 - scrollw / 2 + displayw / 2 - 5
    scrollposy = 272
    pg.gfxdraw.box(bg, [display_msg_x - displayw / 2, display_msg_y - displayh / 2, displayw, displayh], yellowishWhite)
    bg.blit(left_scroll, (leftscrollposx, scrollposy))
    bg.blit(right_scroll, (rightscrollposx, scrollposy))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()  # the bg behind msgs


def corner_decor():
    boxw = 250
    boxh = 125
    w = corner.get_rect().width  # 94
    h = pointer.get_rect().height  # 94
    bg.blit(cornerred, [int(resx / 12 - boxw / 2 + boxw - w + 7), int(resy / 12 * 11- boxh / 2) - 7])
    bg.blit(cornerblue, [int(resx / 12 - boxw / 2 - 7), int(resy / 12 * 11 - boxh / 2 - 7)])


def tfr_curved_text():
    bg.blit(twofailsreq, (qx_pos[3] - questCircleR - 13, qy_b - questCircleR - 27))


def display_score():
    boxw = 250
    boxh = 125
    pg.draw.rect(bg, darkGray, [int(resx / 12 - boxw / 2), int(resy / 12 * 11 - boxh / 2), boxw, boxh])
    font = pg.font.SysFont("Calibri", 110)
    text = font.render('-', 1, lightestGray)  # mellanstreck
    textpos = text.get_rect(center=(resx // 12, resy // 12 * 11))
    bg.blit(text, textpos)
    font = pg.font.SysFont("Calibri", 110)
    text = font.render(str(success_count), 1, blueMark)  # good points
    textpos = text.get_rect(center=(resx // 12 - boxw / 4, resy // 12 * 11.05))
    bg.blit(text, textpos)
    font = pg.font.SysFont("Calibri", 110)
    text = font.render(str(fail_count), 1, redMark)  # evil points
    textpos = text.get_rect(center=(resx // 12 + boxw / 4, resy // 12 * 11.05))
    bg.blit(text, textpos)
    corner_decor()
    screen.blit(bg, (0, 0))
    pg.display.flip()


def esc_quits():
    if event.key == K_ESCAPE:
        os._exit(0)


def wipe_bottom():
    pg.draw.rect(bg, darkGray, [380, 670, 950, 230])  # this is to wipe the bottom text area


def assassination():
    wipe_bottom()
    playerboxw = int((game_boardH / goldenratio) / 2)
    playerboxh = int(1.4 * questCircleR)
    font = pg.font.Font('Enchanted Land.otf', 60)
    text1 = font.render(('Keep your Character cards hidden.'), 1, lightestGray)
    text1pos = text1.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - game_boardH) / 2) - 2.4 * questCircleR + playerboxh / 4)))
    text2 = font.render(('Assassin may reveal their card and choose a target.'), 1, lightestGray)
    text2pos = text2.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - game_boardH) / 2) - 2.4 * questCircleR + playerboxh)))
    bg.blit(text1, text1pos)
    bg.blit(text2, text2pos)

    screen.blit(bg, (0, 0))
    pg.display.flip()


def good_wins():
    wipe_bottom()
    playerboxw = int((game_boardH / goldenratio) / 2)
    playerboxh = int(1.4 * questCircleR)
    font = pg.font.Font('Enchanted Land.otf', 160)
    text = font.render(('Goodness prevails!'), 1, blueMark)
    textpos = text.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - game_boardH) / 2) - 2.4 * questCircleR + playerboxh / 2)))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


def evil_wins():
    wipe_bottom()
    playerboxw = int((game_boardH / goldenratio) / 2)
    playerboxh = int(1.4 * questCircleR)
    font = pg.font.Font('Enchanted Land.otf', 160)
    text = font.render('Evil triumphs!', 1, redMark)
    textpos = text.get_rect(center=(int(resx / 2 - playerboxw / 2),
                                    int(resy - ((resy - game_boardH) / 2) - 2.4 * questCircleR + playerboxh / 2)))
    bg.blit(text, textpos)
    screen.blit(bg, (0, 0))
    pg.display.flip()


###########################################################################################
#Initialising some global variables and loading images
pg.init()

ctypes.windll.user32.SetProcessDPIAware()  # window looks better on laptop
os.environ['SDL_VIDEO_WINDOW_POS'] = "0,0"  # screen starts top left
resx = 1920  # screen width
resy = 1080  # screen height
resolution = (resx, resy)
screen = pg.display.set_mode(resolution)
bg = pg.image.load("castle_wall.jpg")

welcometoavalon = pg.image.load("welcometoavalon.png")
howmanyplayers = pg.image.load("howmanyplayers.png")
verticalscroll = pg.image.load("verticalscroll.png")
left_scroll = pg.image.load("left_scroll100.png")
right_scroll = pg.image.load("right_scroll100.png")
pointer = pg.image.load("location 43.png")
corner = pg.image.load("corner ribbon 94.png")
cornerred = pg.image.load("cornerred94.png")
cornerblue = pg.image.load("cornerblueup94.png")
twofailsreq = pg.image.load("tfr lightergray.png")

# COLORS

black = Color(0, 0, 0)
darkestGray = Color(15, 15, 15)
darkerGray = Color(25, 25, 25)
darkGray = Color(35, 35, 35)
lightGray = Color(55, 55, 55)   # timer circle
lighterGray = Color(65, 65, 65)  # grayPassiveQ
lightestGray = Color(105, 105, 105, 145)  # lightestGray
yellowishWhite = Color(254, 238, 199)
redMark = Color(130, 0, 0, 145)
blueMark = Color(6, 48, 84, 145)
darkWood = Color(128, 78, 0)
lightWood = Color(218, 141, 22)
lighterWood = Color(255, 235, 204)


# GAME RELATED VARIABLES
player_amount = 5
quest_players = [2, 3, 2, 3, 3]
quest_count = 0
success_count = 0
fail_count = 0
vote_count = 0

# These are used when calculating proportions for other objects, test before changing values permanently
game_boardW = int(resx * 0.625)
game_boardH = int(resy * 0.6852)
goldenratio = 1.61803398875
questCircleR = 86  # these can be played with
timerCircleR = 43  # half seems to work best

# SOUNDS AND MUSIC
pg.mixer.music.set_volume(0.10)

qy_b = int(resy / 2)  # vertical position, same for all big circles
qy2 = int(qy_b + 1.75 * timerCircleR)  # vertical position, same for all small circles
qy_v = int(qy_b + 5 * timerCircleR)  # Vertical position for voting circles
timerCircleOffset = int(1.25 * timerCircleR)  # added to big circles x value to get small circles x position

# Quest circle positions
qx_pos = [0] * 5
qx_pos[0] = int(resx / 2 - timerCircleR // 2 - questCircleR * 5)
qx_pos[1] = int(resx / 2 - timerCircleR // 2 - questCircleR * 2.5)
qx_pos[2] = int(resx / 2 - timerCircleR // 2)
qx_pos[3] = int(resx / 2 - timerCircleR // 2 + questCircleR * 2.5)
qx_pos[4] = int(resx / 2 - timerCircleR // 2 + questCircleR * 5)

# Voting circle positions
vote_pos = [0]*5
vote_pos[0] = int(resx / 2 - timerCircleR // 2 - questCircleR * 5)
vote_pos[1] = int(resx / 2 - timerCircleR // 2 - questCircleR * 3.5)
vote_pos[2] = int(resx / 2 - timerCircleR // 2 - questCircleR * 2)
vote_pos[3] = int(resx / 2 - timerCircleR // 2 - questCircleR * 0.5)
vote_pos[4] = int(resx / 2 - timerCircleR // 2 + questCircleR)

# TIMER
Clock = pg.time.Clock()
clocktick = pg.USEREVENT + 1  # roy this to +1 if it fucks up
pg.time.set_timer(clocktick, 1000)  # fired once every second
TotalSeconds = 0
TotalMinutes = 0
QuestSeconds = 0
QuestMinutes = 0

display_msg_x = resx / 2
display_msg_y = 320

quotes_list = ['The only good is knowledge, and the only evil is ignorance.',
               'Man is not what he thinks he is, he is what he hides.',
               'Never attempt to win by force what can be won by deception.',
               'The only thing necessary for the triumph of evil is for good men to do nothing.',
               'Silence in the face of evil is itself evil.',
               'When truth is replaced by silence,the silence is a lie.',
               'Lying is done with words, and also with silence.',
               'Do not be overcome by evil, but overcome evil with good.',
               'Lies are like cockroaches, for every one you discover there are many more that are hidden.',
               'The truest way to be deceived is to think oneself more knowing than others.',
               'It is more shameful to distrust our friends than to be deceived by them.',
               'Even though I walk through the valley of the shadow of death, I will fear no evil.',
               'See no evil, hear no evil, speak no evil.',
               'For even the very wise cannot see all ends.',
               'The treacherous are ever distrustful.',
               'Death smiles on us all. All a man can do is smile back.',
               'Lying is a thriving vocation.',
               'Now I am become Death, the destroyer of worlds.',
               'All spirits are enslaved which serve things evil.',
               'The future depends on what we do in the present.',
               'There\'s small choice in rotten apples.',
               'There has to be evil so that good can prove its purity above it.',
               'Every sweet has its sour; every evil its good.',
               'If you tell the truth, you don\'t have to remember anything.',
               'A truth that\'s told with bad intent beats all the lies you can invent.',
               'Better to get hurt by the truth than comforted with a lie.',
               'A lie can run round the world before the truth has got its boots on.',
               'One who speaks mere portions of truth in order to deceive is a craftsman of destruction.',
               'The devil\'s finest trick is to persuade you that he does not exist.']

# Not in use atm
good_characters = ['Merlin', 'Percival', 'Loyal servant of Arthur']
evil_characters = ['Mordred', 'Morgana', 'Assassin', 'Oberon', 'Minion of Mordred']

current_msg = random.choice(quotes_list)

# Not in use atm
class Player:
    def __init__(self, name, character):
        self.name = name
        self.character = character



#Game starts here
game_board()
Clock.tick(60)  # ensures a maximum of 60 frames per second, RELATED TO TIMER

night = False
main_menu = True

# Start of the game. Choose number of players and press enter to move to "Night phase"
while main_menu:
    welcome_screen()
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
            if event.key == K_1:
                player_amount = 10
                quest_players = [3, 4, 4, 5, 5]
            if event.key == K_RETURN and player_amount > 4:
                main_menu = False
                night = True
            esc_quits()
            print('player amount is ' + str(player_amount))




# Everyone should close their eyes and have their hand in a fist on the table...
while night:
    night_phase()
    for event in pg.event.get():
        if event.type == pg.KEYDOWN:
            if event.key == K_RETURN:
                wipe_board()
                pg.display.flip()
                night = False
            esc_quits()


# Initialize game board
# Game begins, by calling funtion quest_bg()
quest_bg(quest_players)

# Add text "2 fails required
if player_amount > 6:
    tfr_curved_text()

player_box()
display_msg(current_msg)
place_pointer(qx_pos[0])
display_score()
corner_decor()
ass_phase = True    # this is just to activate assassination later


game_running = True
voting_phase = True


def voting_phase_func():
    global voting_phase, vote_count
    if vote_count == 5:
        evil_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits()
    else:
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits()
                if event.key == pg.K_s:
                    voting_phase = False
                    draw_vote()
                    vote_count = 0
                elif event.key == pg.K_f:
                    vote_stamp(vote_pos[vote_count])
                    voting_phase = True
            if event.type == clocktick:
                clocks_increase()
                quest_timer(qx_pos[quest_count])


while game_running:
    if voting_phase and success_count < 3 and fail_count < 3:
        voting_phase_func()
    else:
        if quest_count == 0 or quest_count == 1 or quest_count == 2:
                for event in pg.event.get():
                    if event.type == pg.KEYDOWN:
                        quest_stamp(qx_pos[quest_count])
                        esc_quits()
                        if event.key == pg.K_s or event.key == pg.K_f:
                            move_pointer(qx_pos[quest_count-1], qx_pos[quest_count])
                            voting_phase = True
                    if event.type == clocktick:
                        clocks_increase()
                        quest_timer(qx_pos[quest_count])

        elif quest_count == 3 and success_count < 3 and fail_count < 3:
            for event in pg.event.get():
                if event.type == pg.KEYDOWN:
                    quest_stamp(qx_pos[quest_count])
                    esc_quits()
                    if event.key == pg.K_s or event.key == pg.K_f:
                        move_pointer(qx_pos[quest_count-1], qx_pos[quest_count])
                        voting_phase = True
                if event.type == clocktick:
                    clocks_increase()
                    quest_timer(qx_pos[quest_count])

        elif quest_count == 4 and success_count < 3 and fail_count < 3:
            for event in pg.event.get():
                if event.type == pg.KEYDOWN:
                    quest_stamp(qx_pos[quest_count])
                    esc_quits()
                if event.type == clocktick:
                    clocks_increase()
                    quest_timer(qx_pos[quest_count])

    if success_count == 3 and ass_phase is True and fail_count < 3:
        assassination()
        clear_pointers()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits()
                if event.key == pg.K_g:
                    ass_phase = False
                elif event.key == pg.K_e:
                    fail_count = 3
            if event.type == clocktick:
                clocks_increase()
                total_timer()
    elif success_count == 3 and ass_phase is False and main_menu is False:
        good_wins()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits()
    elif fail_count == 3:
        evil_wins()
        clear_pointers()
        for event in pg.event.get():
            if event.type == pg.KEYDOWN:
                esc_quits()

