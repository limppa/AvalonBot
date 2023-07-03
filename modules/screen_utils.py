import ctypes
import os
import pygame as pg

def initialize_screen(resx, resy):
    # window looks better on laptop
    ctypes.windll.user32.SetProcessDPIAware()
    # screen starts top left
    os.environ['SDL_VIDEO_WINDOW_POS'] = "0,0"
    resolution = (resx, resy)
    screen = pg.display.set_mode(resolution, pg.FULLSCREEN)
    return screen