"""Read actual X11 input regions inside the isolated native GUI probe only."""
import ctypes as c
import os
import sys

if os.environ.get('TWIRCHAT_GUI_QA') != '1' or os.environ.get('DISPLAY') != ':99':
    raise RuntimeError('X11 region probe requires the private GUI QA display')
if os.environ.get('WAYLAND_DISPLAY'):
    raise RuntimeError('Host compositor access is forbidden')

x11 = c.CDLL('libX11.so.6')
xext = c.CDLL('libXext.so.6')
x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = c.c_void_p
x11.XDefaultRootWindow.argtypes = [c.c_void_p]
x11.XDefaultRootWindow.restype = c.c_ulong
x11.XQueryTree.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.POINTER(c.c_ulong)), c.POINTER(c.c_uint)]
x11.XFetchName.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_void_p)]
x11.XFree.argtypes = [c.c_void_p]
x11.XCloseDisplay.argtypes = [c.c_void_p]
xext.XShapeGetRectangles.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.POINTER(c.c_int), c.POINTER(c.c_int)]
xext.XShapeGetRectangles.restype = c.c_void_p

display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError('Private X11 display unavailable')


def find(window, wanted):
    name = c.c_void_p()
    x11.XFetchName(display, window, c.byref(name))
    label = c.string_at(name.value).decode() if name.value else ''
    if name.value:
        x11.XFree(name)
    if label == wanted:
        return window
    root = c.c_ulong()
    parent = c.c_ulong()
    children = c.POINTER(c.c_ulong)()
    count = c.c_uint()
    if x11.XQueryTree(display, window, c.byref(root), c.byref(parent), c.byref(children), c.byref(count)):
        windows = [children[index] for index in range(count.value)]
        if children:
            x11.XFree(children)
        for child in windows:
            result = find(child, wanted)
            if result:
                return result
    return None


try:
    window = find(x11.XDefaultRootWindow(display), sys.argv[1])
    if window is None:
        raise RuntimeError('Native probe window missing')
    count = c.c_int()
    ordering = c.c_int()
    rectangles = xext.XShapeGetRectangles(display, window, 2, c.byref(count), c.byref(ordering))
    if rectangles:
        x11.XFree(rectangles)
    print(count.value)
finally:
    x11.XCloseDisplay(display)
