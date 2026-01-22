from PIL import Image, ImageDraw, ImageFont

W, H = 200, 260
img = Image.new('RGBA', (W, H), (255, 255, 255, 0))
draw = ImageDraw.Draw(img)

# Draw teardrop pin: circle on top + triangle tail
cx, cy = W//2, 60
r = 56
draw.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(225,43,43,255))

# Triangle tail
tail_top_y = cy + r - 6
tail = [(cx-36, tail_top_y), (cx+36, tail_top_y), (cx, H-20)]
draw.polygon(tail, fill=(225,43,43,255))

# Inner white hole
draw.ellipse((cx-28, cy-28, cx+28, cy+28), fill=(255,255,255,255))

# Optional label area (transparent, label will be text overlaid by CSS)

img.save('assets/pin.png')
print('Generated assets/pin.png')
