function createMarkerIcon(color: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
        // Draw outer circle (white stroke)
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    return canvas;
}

export { createMarkerIcon };
