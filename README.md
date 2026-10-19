# Pegzel

**From pixels to pegs.**

Pegzel turns images into editable **78 × 44 binary pegboard maps**. Each position is either a peg (1) or an empty hole (0).

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open [Install Pegzel](https://raw.githubusercontent.com/penguin-zoo/pegzel/main/pegzel.user.js) to install the userscript.
3. On an ordinary HTTP/HTTPS webpage, use the Tampermonkey menu command **Open / close Pegzel**.

The mapper opens only when requested. It does not automatically replace webpages.

## Features

- Drop or open an image; drag to pan and use the mouse wheel to zoom
- Luminance, red, green, blue and max-RGB source interpretation
- Threshold, blur, contrast, invert, dither and edge-preserving processing
- Binary circle preview, optional empty-hole outlines
- Manual pen and eraser overrides
- Export a 78 × 44 text grid or a PNG preview
- Runs locally in the browser

Colour-channel settings affect only how the source image is interpreted. **The output is always binary.**

## Release

v1.9.0 — initial GitHub userscript release with menu-based launch.
