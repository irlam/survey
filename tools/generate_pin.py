from PIL import Image, ImageDraw, ImageFont

W, H = 260, 220
img = Image.new('RGBA', (W, H), (255, 255, 255, 0))
draw = ImageDraw.Draw(img)

# Draw wider, shorter teardrop pin: larger circle on top + shorter tail
cx, cy = W // 2, 70
circle_r_x = 80
circle_r_y = 72
# Use an ellipse to make it slightly wider horizontally
draw.ellipse((cx - circle_r_x, cy - circle_r_y, cx + circle_r_x, cy + circle_r_y), fill=(225, 43, 43, 255))

# Shorter triangle tail
tail_top_y = cy + circle_r_y - 8
tail = [(cx - 44, tail_top_y), (cx + 44, tail_top_y), (cx, H - 18)]
draw.polygon(tail, fill=(225, 43, 43, 255))

# Inner white hole (larger to fit label)
hole_rx = 36
hole_ry = 34
draw.ellipse((cx - hole_rx, cy - hole_ry, cx + hole_rx, cy + hole_ry), fill=(255, 255, 255, 255))

# Save PNG with transparency
img.save('assets/pin.png')
print('Generated assets/pin.png')
