"""Pegboard Mapper by Pegzel — standalone Python desktop edition.

Requires Pillow and a Python distribution with Tkinter.
Optional: tkinterdnd2 for image drag-and-drop.
"""

import os
import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk, ImageOps, ImageDraw, ImageFilter, ImageEnhance

# Optional drag/drop support
DND_AVAILABLE = False
try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    DND_AVAILABLE = True
except Exception:
    DND_AVAILABLE = False


BOARD_W = 78
BOARD_H = 44

DEFAULT_THRESHOLD = 128
DEFAULT_INVERT = False
DEFAULT_SHOW_HOLES = True
DEFAULT_DITHER = False
DEFAULT_BLUR = 1.2
DEFAULT_CONTRAST = 1.35

PREVIEW_CELL = 10
PREVIEW_MARGIN = 16


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def parse_dropped_files(data: str):
    results = []
    current = ""
    in_brace = False

    for ch in data:
        if ch == "{":
            in_brace = True
            if current.strip():
                results.append(current.strip())
                current = ""
        elif ch == "}":
            in_brace = False
            if current:
                results.append(current)
                current = ""
        elif ch == " " and not in_brace:
            if current.strip():
                results.append(current.strip())
                current = ""
        else:
            current += ch

    if current.strip():
        results.append(current.strip())

    cleaned = []
    for p in results:
        p = p.strip().strip('"').strip("'")
        if p:
            cleaned.append(p)
    return cleaned


class PegboardApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Pegboard Mapper — by Pegzel")

        self.original_image = None
        self.tk_display_image = None
        self.current_path = None

        self.base_fit_scale = 1.0
        self.zoom = 1.0

        self.offset_x = 0.0
        self.offset_y = 0.0

        self.dragging = False
        self.last_mouse_x = 0
        self.last_mouse_y = 0

        self.threshold_var = tk.IntVar(value=DEFAULT_THRESHOLD)
        self.invert_var = tk.BooleanVar(value=DEFAULT_INVERT)
        self.show_holes_var = tk.BooleanVar(value=DEFAULT_SHOW_HOLES)
        self.dither_var = tk.BooleanVar(value=DEFAULT_DITHER)
        self.blur_var = tk.DoubleVar(value=DEFAULT_BLUR)
        self.contrast_var = tk.DoubleVar(value=DEFAULT_CONTRAST)

        self.status_var = tk.StringVar(value="Open an image or drop one onto the window")
        self.channel_var = tk.StringVar(value="Luminance")
        self.tool_var = tk.StringVar(value="Pan")
        self.manual_edits = {}
        self._pending_resize = None

        self.build_ui()
        self.bind_events()
        self.size_window_to_screen()

        self.root.after(150, self.update_all)

    def size_window_to_screen(self):
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()

        app_w = int(screen_w * 0.96)
        app_h = int(screen_h * 0.90)

        x = max(10, (screen_w - app_w) // 2)
        y = max(10, (screen_h - app_h) // 2)

        self.root.geometry(f"{app_w}x{app_h}+{x}+{y}")
        self.root.minsize(1100, 650)

    def build_ui(self):
        self.root.configure(bg="#e9e9e9")

        top = tk.Frame(self.root, bg="#e9e9e9")
        top.pack(fill="x", padx=10, pady=(10, 6))

        tk.Button(top, text="Open Image", command=self.open_image).pack(side="left")
        tk.Button(top, text="Clear Edits", command=self.clear_edits).pack(side="left", padx=(8, 0))
        tk.Button(top, text="Reset View", command=self.reset_view).pack(side="left", padx=(8, 0))
        tk.Button(top, text="Export Peg Preview PNG", command=self.export_preview).pack(side="left", padx=(8, 0))
        tk.Button(top, text="Export 0/1 Grid TXT", command=self.export_grid_txt).pack(side="left", padx=(8, 0))

        tk.Label(top, text="Zoom", bg="#e9e9e9").pack(side="left", padx=(18, 6))
        self.zoom_slider = tk.Scale(
            top,
            from_=0.2,
            to=8.0,
            resolution=0.01,
            orient="horizontal",
            length=220,
            command=self.on_zoom_slider,
        )
        self.zoom_slider.set(1.0)
        self.zoom_slider.pack(side="left")

        controls = tk.Frame(self.root, bg="#e9e9e9")
        controls.pack(fill="x", padx=10, pady=(0, 8))

        tk.Label(controls, text="Threshold", bg="#e9e9e9").pack(side="left")
        tk.Scale(
            controls,
            from_=0,
            to=255,
            orient="horizontal",
            length=160,
            variable=self.threshold_var,
            command=lambda _=None: self.update_all(),
        ).pack(side="left", padx=(6, 18))

        tk.Label(controls, text="Blur", bg="#e9e9e9").pack(side="left")
        tk.Scale(
            controls,
            from_=0.0,
            to=4.0,
            resolution=0.1,
            orient="horizontal",
            length=140,
            variable=self.blur_var,
            command=lambda _=None: self.update_all(),
        ).pack(side="left", padx=(6, 18))

        tk.Label(controls, text="Contrast", bg="#e9e9e9").pack(side="left")
        tk.Scale(
            controls,
            from_=0.5,
            to=3.0,
            resolution=0.05,
            orient="horizontal",
            length=140,
            variable=self.contrast_var,
            command=lambda _=None: self.update_all(),
        ).pack(side="left", padx=(6, 18))

        tk.Checkbutton(
            controls,
            text="Invert",
            variable=self.invert_var,
            bg="#e9e9e9",
            command=self.update_all,
        ).pack(side="left", padx=(0, 12))

        tk.Checkbutton(
            controls,
            text="Show empty holes",
            variable=self.show_holes_var,
            bg="#e9e9e9",
            command=self.update_all,
        ).pack(side="left", padx=(0, 12))

        tk.Checkbutton(
            controls,
            text="Dither",
            variable=self.dither_var,
            bg="#e9e9e9",
            command=self.update_all,
        ).pack(side="left")

        tk.Label(controls, text="Channel", bg="#e9e9e9").pack(side="left")
        tk.OptionMenu(controls, self.channel_var, "Luminance", "Red", "Green", "Blue", "Max RGB",
                      command=lambda _: self.update_all()).pack(side="left")
        tk.Label(controls, text="Tool", bg="#e9e9e9").pack(side="left")
        tk.OptionMenu(controls, self.tool_var, "Pan", "Pen", "Eraser").pack(side="left")

        middle = tk.Frame(self.root, bg="#e9e9e9")
        middle.pack(fill="both", expand=True, padx=10, pady=(0, 8))

        left_wrap = tk.Frame(middle, bg="#d9d9d9", bd=1, relief="sunken")
        left_wrap.pack(side="left", fill="both", expand=True)

        self.image_canvas = tk.Canvas(
            left_wrap,
            bg="#bfbfbf",
            highlightthickness=0
        )
        self.image_canvas.pack(fill="both", expand=True)

        preview_wrap = tk.Frame(middle, bg="#d9d9d9", bd=1, relief="sunken")
        preview_wrap.pack(side="left", padx=(10, 0), fill="y")

        tk.Label(
            preview_wrap,
            text="Live peg preview (78 x 44)",
            bg="#d9d9d9"
        ).pack(pady=(6, 2))

        self.preview_canvas = tk.Canvas(
            preview_wrap,
            bg="#f4f4f4",
            highlightthickness=0
        )
        self.preview_canvas.pack(padx=8, pady=(0, 8), fill="both", expand=False)

        bottom = tk.Frame(self.root, bg="#e9e9e9")
        bottom.pack(fill="x", padx=10, pady=(0, 10))

        self.status = tk.Label(
            bottom,
            textvariable=self.status_var,
            anchor="w",
            bg="#e9e9e9"
        )
        self.status.pack(fill="x")

        if DND_AVAILABLE:
            self.root.drop_target_register(DND_FILES)
            self.root.dnd_bind("<<Drop>>", self.on_drop)

            self.image_canvas.drop_target_register(DND_FILES)
            self.image_canvas.dnd_bind("<<Drop>>", self.on_drop)
        else:
            self.status_var.set(
                "Drag/drop support not active. Click Open Image, or install: python -m pip install tkinterdnd2"
            )

    def bind_events(self):
        self.image_canvas.bind("<ButtonPress-1>", self.start_drag)
        self.image_canvas.bind("<B1-Motion>", self.do_drag)
        self.image_canvas.bind("<ButtonRelease-1>", self.stop_drag)

        self.image_canvas.bind("<MouseWheel>", self.on_mousewheel)
        self.image_canvas.bind("<Button-4>", self.on_mousewheel)
        self.image_canvas.bind("<Button-5>", self.on_mousewheel)

        self.root.bind("<Configure>", self.on_resize)
        self.preview_canvas.bind("<ButtonPress-1>", self.on_preview_paint)
        self.preview_canvas.bind("<B1-Motion>", self.on_preview_paint)

    def on_resize(self, event):
        if self._pending_resize is not None:
            self.root.after_cancel(self._pending_resize)
        self._pending_resize = self.root.after(70, self._do_resize)

    def _do_resize(self):
        self._pending_resize = None
        self.update_all()

    def open_image(self):
        path = filedialog.askopenfilename(
            title="Select image",
            filetypes=[
                ("Image files", "*.png *.jpg *.jpeg *.bmp *.gif *.webp *.tif *.tiff"),
                ("All files", "*.*"),
            ],
        )
        if path:
            self.load_image(path)

    def on_drop(self, event):
        files = parse_dropped_files(event.data)
        if not files:
            return
        path = files[0]
        self.load_image(path)

    def load_image(self, path):
        try:
            img = Image.open(path).convert("RGB")
        except Exception as e:
            messagebox.showerror("Error", f"Could not open image:\n{e}")
            return

        self.original_image = img
        self.manual_edits.clear()
        self.current_path = path
        self.reset_view()
        self.status_var.set(f"Loaded: {os.path.basename(path)}")

    def reset_view(self):
        if self.original_image is None:
            return

        cw = max(1, self.image_canvas.winfo_width())
        ch = max(1, self.image_canvas.winfo_height())

        iw, ih = self.original_image.size
        self.base_fit_scale = min(cw / iw, ch / ih)
        self.zoom = 1.0
        self.zoom_slider.set(self.zoom)

        self.offset_x = 0.0
        self.offset_y = 0.0
        self.update_all()

    def on_zoom_slider(self, value):
        try:
            self.zoom = float(value)
        except Exception:
            return
        self.update_all()

    def start_drag(self, event):
        self.dragging = True
        self.last_mouse_x = event.x
        self.last_mouse_y = event.y

    def do_drag(self, event):
        if self.original_image is None or not self.dragging:
            return
        dx = event.x - self.last_mouse_x
        dy = event.y - self.last_mouse_y
        self.last_mouse_x = event.x
        self.last_mouse_y = event.y

        self.offset_x += dx
        self.offset_y += dy
        self.update_all()

    def stop_drag(self, event):
        self.dragging = False

    def on_mousewheel(self, event):
        if self.original_image is None:
            return

        old_zoom = self.zoom

        if hasattr(event, "delta") and event.delta:
            if event.delta > 0:
                self.zoom *= 1.1
            else:
                self.zoom /= 1.1
        else:
            if getattr(event, "num", None) == 4:
                self.zoom *= 1.1
            elif getattr(event, "num", None) == 5:
                self.zoom /= 1.1

        self.zoom = clamp(self.zoom, 0.2, 8.0)
        self.zoom_slider.set(self.zoom)

        cx = self.image_canvas.winfo_width() / 2
        cy = self.image_canvas.winfo_height() / 2
        mx = event.x
        my = event.y

        if old_zoom != 0:
            factor = self.zoom / old_zoom
            self.offset_x = (self.offset_x - (mx - cx)) * factor + (mx - cx)
            self.offset_y = (self.offset_y - (my - cy)) * factor + (my - cy)

        self.update_all()

    def get_display_geometry(self):
        cw = max(1, self.image_canvas.winfo_width())
        ch = max(1, self.image_canvas.winfo_height())

        scale = self.base_fit_scale * self.zoom

        iw, ih = self.original_image.size
        disp_w = max(1, int(iw * scale))
        disp_h = max(1, int(ih * scale))

        center_x = cw / 2 + self.offset_x
        center_y = ch / 2 + self.offset_y

        left = center_x - disp_w / 2
        top = center_y - disp_h / 2
        right = left + disp_w
        bottom = top + disp_h

        return disp_w, disp_h, left, top, right, bottom

    def get_board_rect(self):
        cw = max(1, self.image_canvas.winfo_width())
        ch = max(1, self.image_canvas.winfo_height())

        rect_ratio = BOARD_W / BOARD_H

        if cw / ch > rect_ratio:
            rh = ch * 0.92
            rw = rh * rect_ratio
        else:
            rw = cw * 0.92
            rh = rw / rect_ratio

        rx1 = (cw - rw) / 2
        ry1 = (ch - rh) / 2
        rx2 = rx1 + rw
        ry2 = ry1 + rh

        return rx1, ry1, rx2, ry2

    def render_left_canvas(self):
        self.image_canvas.delete("all")

        cw = max(1, self.image_canvas.winfo_width())
        ch = max(1, self.image_canvas.winfo_height())

        self.image_canvas.create_rectangle(0, 0, cw, ch, fill="#bfbfbf", outline="")

        if self.original_image is None:
            self.image_canvas.create_text(
                cw / 2,
                ch / 2 - 10,
                text="Drop image here",
                font=("Helvetica", 24, "bold"),
                fill="#333333"
            )
            self.image_canvas.create_text(
                cw / 2,
                ch / 2 + 24,
                text="or click Open Image",
                font=("Helvetica", 14),
                fill="#333333"
            )
            return

        disp_w, disp_h, left, top, right, bottom = self.get_display_geometry()

        disp = self.original_image.resize((disp_w, disp_h), Image.Resampling.LANCZOS)
        self.tk_display_image = ImageTk.PhotoImage(disp)
        self.image_canvas.create_image(left, top, anchor="nw", image=self.tk_display_image)

        rx1, ry1, rx2, ry2 = self.get_board_rect()

        self.image_canvas.create_rectangle(
            rx1, ry1, rx2, ry2,
            outline="#00ff88",
            width=2
        )

        self.image_canvas.create_rectangle(0, 0, cw, ry1, fill="#000000", stipple="gray50", outline="")
        self.image_canvas.create_rectangle(0, ry2, cw, ch, fill="#000000", stipple="gray50", outline="")
        self.image_canvas.create_rectangle(0, ry1, rx1, ry2, fill="#000000", stipple="gray50", outline="")
        self.image_canvas.create_rectangle(rx2, ry1, cw, ry2, fill="#000000", stipple="gray50", outline="")

    def get_board_crop_from_view(self):
        if self.original_image is None:
            return None

        cw = max(1, self.image_canvas.winfo_width())
        ch = max(1, self.image_canvas.winfo_height())

        rx1, ry1, rx2, ry2 = self.get_board_rect()

        backing = Image.new("RGB", (cw, ch), (191, 191, 191))

        disp_w, disp_h, left, top, right, bottom = self.get_display_geometry()
        disp = self.original_image.resize((disp_w, disp_h), Image.Resampling.LANCZOS)

        paste_x = int(round(left))
        paste_y = int(round(top))
        backing.paste(disp, (paste_x, paste_y))

        crop = backing.crop((int(rx1), int(ry1), int(rx2), int(ry2)))
        return crop

    def make_binary_grid(self):
        crop = self.get_board_crop_from_view()
        if crop is None:
            return None

        mode = self.channel_var.get()
        if mode == "Red":
            gray = crop.getchannel("R")
        elif mode == "Green":
            gray = crop.getchannel("G")
        elif mode == "Blue":
            gray = crop.getchannel("B")
        elif mode == "Max RGB":
            rgb_pixels = list(crop.getdata())
            gray = Image.frombytes("L", crop.size, bytes(max(p) for p in rgb_pixels))
        else:
            gray = crop.convert("L")

        blur_radius = self.blur_var.get()
        if blur_radius > 0:
            gray = gray.filter(ImageFilter.GaussianBlur(radius=blur_radius))

        contrast = self.contrast_var.get()
        if contrast != 1.0:
            gray = ImageEnhance.Contrast(gray).enhance(contrast)

        if self.invert_var.get():
            gray = ImageOps.invert(gray)

        small = gray.resize((BOARD_W, BOARD_H), Image.Resampling.LANCZOS)

        if self.dither_var.get():
            bw = small.convert("1")
            grid = []
            for y in range(BOARD_H):
                row = []
                for x in range(BOARD_W):
                    row.append(1 if bw.getpixel((x, y)) == 0 else 0)
                grid.append(row)
            return self.apply_manual_edits(grid)

        threshold = self.threshold_var.get()

        grid = []
        for y in range(BOARD_H):
            row = []
            for x in range(BOARD_W):
                px = small.getpixel((x, y))
                row.append(1 if px < threshold else 0)
            grid.append(row)

        return self.apply_manual_edits(grid)

    def apply_manual_edits(self, grid):
        for (x, y), value in self.manual_edits.items():
            if 0 <= x < BOARD_W and 0 <= y < BOARD_H:
                grid[y][x] = value
        return grid

    def on_preview_paint(self, event):
        tool = self.tool_var.get()
        if tool == "Pan" or self.original_image is None:
            return
        x = int((event.x - PREVIEW_MARGIN) / PREVIEW_CELL)
        y = int((event.y - PREVIEW_MARGIN) / PREVIEW_CELL)
        if 0 <= x < BOARD_W and 0 <= y < BOARD_H:
            self.manual_edits[(x, y)] = 1 if tool == "Pen" else 0
            self.render_preview()

    def clear_edits(self):
        self.manual_edits.clear()
        self.render_preview()

    def render_preview(self):
        self.preview_canvas.delete("all")

        grid = self.make_binary_grid()
        if grid is None:
            return

        canvas_w = BOARD_W * PREVIEW_CELL + PREVIEW_MARGIN * 2
        canvas_h = BOARD_H * PREVIEW_CELL + PREVIEW_MARGIN * 2
        self.preview_canvas.config(width=canvas_w, height=canvas_h)

        self.preview_canvas.create_rectangle(0, 0, canvas_w, canvas_h, fill="#f4f4f4", outline="")

        r = PREVIEW_CELL * 0.38
        peg_count = 0

        for y in range(BOARD_H):
            for x in range(BOARD_W):
                cx = PREVIEW_MARGIN + x * PREVIEW_CELL + PREVIEW_CELL / 2
                cy = PREVIEW_MARGIN + y * PREVIEW_CELL + PREVIEW_CELL / 2

                x1, y1 = cx - r, cy - r
                x2, y2 = cx + r, cy + r

                if self.show_holes_var.get():
                    self.preview_canvas.create_oval(
                        x1, y1, x2, y2,
                        outline="#d3d3d3",
                        width=1
                    )

                if grid[y][x] == 1:
                    peg_count += 1
                    self.preview_canvas.create_oval(
                        x1, y1, x2, y2,
                        fill="#111111",
                        outline="#111111"
                    )

        total = BOARD_W * BOARD_H
        self.status_var.set(
            f"Pegs: {peg_count} / {total}   |   Fill: {peg_count / total:.1%}   |   Zoom: {self.zoom:.2f}x"
        )

    def update_all(self):
        self.render_left_canvas()
        self.render_preview()

    def export_preview(self):
        grid = self.make_binary_grid()
        if grid is None:
            return

        path = filedialog.asksaveasfilename(
            title="Save peg preview",
            defaultextension=".png",
            filetypes=[("PNG image", "*.png")]
        )
        if not path:
            return

        cell = 24
        margin = 24
        w = BOARD_W * cell + margin * 2
        h = BOARD_H * cell + margin * 2

        img = Image.new("RGB", (w, h), (244, 244, 244))
        draw = ImageDraw.Draw(img)

        r = cell * 0.38

        for y in range(BOARD_H):
            for x in range(BOARD_W):
                cx = margin + x * cell + cell / 2
                cy = margin + y * cell + cell / 2
                bbox = (cx - r, cy - r, cx + r, cy + r)

                if self.show_holes_var.get():
                    draw.ellipse(bbox, outline=(211, 211, 211), width=1)

                if grid[y][x] == 1:
                    draw.ellipse(bbox, fill=(17, 17, 17), outline=(17, 17, 17))

        img.save(path)
        messagebox.showinfo("Saved", f"Saved preview PNG:\n{path}")

    def export_grid_txt(self):
        grid = self.make_binary_grid()
        if grid is None:
            return

        path = filedialog.asksaveasfilename(
            title="Save grid text",
            defaultextension=".txt",
            filetypes=[("Text file", "*.txt")]
        )
        if not path:
            return

        with open(path, "w", encoding="utf-8") as f:
            f.write(f"{BOARD_W}x{BOARD_H}\n\n")
            for row in grid:
                f.write("".join(str(v) for v in row) + "\n")

        messagebox.showinfo("Saved", f"Saved 0/1 grid:\n{path}")


def main():
    if DND_AVAILABLE:
        root = TkinterDnD.Tk()
    else:
        root = tk.Tk()

    app = PegboardApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()