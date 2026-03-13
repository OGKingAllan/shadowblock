from PIL import Image, ImageDraw
import os

def create_shield_icon(size):
    """Create a dark shield icon with purple accent."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = size * 0.08
    w = size - margin * 2
    h = size - margin * 2
    cx = size / 2

    # Shield path as polygon
    points = [
        (cx, margin),
        (margin, margin + h * 0.15),
        (margin, margin + h * 0.55),
        (cx, margin + h),
        (size - margin, margin + h * 0.55),
        (size - margin, margin + h * 0.15),
    ]

    # Dark fill
    draw.polygon(points, fill=(26, 26, 46, 255))

    # Purple accent line (inner shield highlight)
    accent_inset = size * 0.15
    accent_points = [
        (cx, margin + accent_inset),
        (margin + accent_inset, margin + h * 0.2),
        (margin + accent_inset, margin + h * 0.5),
        (cx, margin + h - accent_inset * 0.5),
        (size - margin - accent_inset, margin + h * 0.5),
        (size - margin - accent_inset, margin + h * 0.2),
    ]
    draw.polygon(accent_points, outline=(124, 58, 237, 200), width=max(1, size // 32))

    # Small slash detail in center
    eye_y = margin + h * 0.38
    slash_len = size * 0.18
    draw.line(
        [(cx - slash_len, eye_y - slash_len * 0.3), (cx + slash_len, eye_y + slash_len * 0.3)],
        fill=(124, 58, 237, 180), width=max(1, size // 24)
    )

    return img

base = os.path.dirname(os.path.abspath(__file__)) + '/../icons'
os.makedirs(base, exist_ok=True)
for sz in [16, 48, 128]:
    img = create_shield_icon(sz)
    img.save(f'{base}/icon{sz}.png')
    print(f'Generated icon{sz}.png')
