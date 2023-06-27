import pygame as pg

def load_images():
    images = {}
    images['castlewall'] = pg.image.load("images/castle_wall.jpg").convert()
    images['welcometoavalon'] = pg.image.load("images/welcometoavalon.png").convert_alpha()
    images['howmanyplayers'] = pg.image.load("images/howmanyplayers.png").convert_alpha()
    images['verticalscroll'] = pg.image.load("images/vertical_scroll_143pxw.png").convert_alpha()
    images['leftscroll'] = pg.image.load("images/left_scroll_100pxh.png").convert_alpha()
    images['rightscroll'] = pg.image.load("images/right_scroll_100pxh.png").convert_alpha()
    images['pointer'] = pg.image.load("images/pointer_43px.png").convert_alpha()
    images['cornerribbonred'] = pg.image.load("images/corner_ribbon_red_94px.png").convert_alpha()
    images['cornerribbonblue'] = pg.image.load("images/corner_ribbon_blue_94px.png").convert_alpha()
    images['twofailsreq'] = pg.image.load("images/twofailsrequired_lightergray.png").convert_alpha()

    return images