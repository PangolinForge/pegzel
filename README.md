# Pegboard Mapper — by Pegzel

**Convert images into binary pegboard patterns.**

Pegboard Mapper turns images into a grid of **pegs (1)** and **empty holes (0)**. The default board is **78 columns × 44 rows** (3,432 positions). Choose how the source image is interpreted, refine the result, and export a placement pattern.

## Install the browser version (recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. **[Install Pegboard Mapper](https://raw.githubusercontent.com/penguin-zoo/pegzel/main/pegboard-mapper.user.js)**.
3. Open any regular HTTP or HTTPS website, open the **Tampermonkey menu**, then choose **Open / close Pegboard Mapper**.

The userscript uses a general HTTP/HTTPS match only to register a launch command. **It does not automatically take over webpages**, and image processing runs locally in your browser.

### Browser features

- Open an image or drop one into the workspace
- Drag to position and use the scroll wheel to zoom
- Control threshold, blur, contrast, invert, dithering, and edge preservation
- Interpret source images using luminance, red, green, blue, or maximum RGB
- Draw or erase individual pegs, with manual overrides retained across processing changes
- Preview the circular pegs and empty holes
- Export a binary text grid and a PNG preview

A channel selection only changes **how input colours become a binary pattern**; the output is always peg/no peg.

## Run the Python desktop version

The Python implementation is in **[pegboard_mapper.py](pegboard_mapper.py)**.

You will need a Python installation with **Tkinter** support. On some installations, Tkinter is supplied by the operating system or Python installer and cannot be added with pip alone.

```bash
python -m pip install -r requirements.txt
python pegboard_mapper.py
```

For optional drag-and-drop support:

```bash
python -m pip install tkinterdnd2
```

Without `tkinterdnd2`, use **Open Image**. The Python desktop version supports file opening, pan and zoom, source-channel selection, thresholding, blur, contrast, optional dithering, manual pen/eraser editing and exporting TXT/PNG. The two editions are **not pixel-for-pixel equivalent**, and the browser build remains the recommended version.

## Grid format

A text export begins with a dimensions header and contains one binary row per line:

```text
78x44

000000...000
001110...000
...
```

`1` means a peg is present; `0` means the hole is empty.

## Example work

The project originated from experimenting with images and a binary pegboard: a portrait converted using a colour channel, and pixel-art figures converted using different zoom and threshold settings. Screenshots from these experiments can be added once their distribution rights have been reviewed.

**Artwork credits:** Shepard Fairey's *Barack Obama “HOPE”* artwork (2008) derives from a Mannie Garcia photograph. Mario, Luigi and Yoshi are Nintendo characters. References to these works do not imply sponsorship, ownership, or a licence to redistribute their original imagery.

## Project and releases

**Pegzel** is the name of the repository/project; **Pegboard Mapper** is the name of the application.

This is an experimental image-to-pegboard conversion tool. The Python and browser interfaces may differ in details of filtering and colour conversion. Please report defects and suggestions using GitHub Issues.

## Licence and third-party artwork

See [LICENSE](LICENSE) for the licence covering original source code. The source-code licence does **not** apply to third-party artwork, character designs, trademarks, or example images owned by others.

## Discoverability

Image-to-pegboard converter · Pegboard pattern generator · Binary art · Pixel-art mapper · Tampermonkey userscript · Python image conversion
