import ctypes
import os
import pygame as pg

def initialize_screen():
    pg.init()
    # window looks better on laptop
    #ctypes.windll.user32.SetProcessDPIAware()
    # screen starts top left
    os.environ['SDL_VIDEO_WINDOW_POS'] = "0,0"
    resx = 1920  # screen width
    resy = 1080  # screen height
    resolution = (resx, resy)
    screen = pg.display.set_mode(resolution)
    return screen