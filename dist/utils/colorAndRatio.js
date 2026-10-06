"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAspectRatio = calculateAspectRatio;
exports.calculateColorMatch = calculateColorMatch;
exports.hexToColorName = hexToColorName;
// Helper: Calculate closest standard aspect ratio
function calculateAspectRatio(width, height) {
    if (!width || !height)
        return "1:1";
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.08)
        return "1:1";
    if (Math.abs(ratio - 0.8) < 0.08)
        return "4:5";
    if (Math.abs(ratio - 1.777) < 0.12)
        return "16:9";
    if (Math.abs(ratio - 0.5625) < 0.1)
        return "9:16";
    if (Math.abs(ratio - 1.333) < 0.08)
        return "4:3";
    if (Math.abs(ratio - 0.75) < 0.08)
        return "3:4";
    if (Math.abs(ratio - 1.5) < 0.08)
        return "3:2";
    if (Math.abs(ratio - 0.666) < 0.08)
        return "2:3";
    if (Math.abs(ratio - 1.91) < 0.12)
        return "1.91:1";
    if (Math.abs(ratio - 2.33) < 0.15)
        return "21:9";
    return ratio > 1
        ? `${Math.round(ratio * 10) / 10}:1`
        : `1:${Math.round((1 / ratio) * 10) / 10}`;
}
// Helper: Calculate color similarity percentage (0-100) between two HEX colors
function calculateColorMatch(hex1, hex2) {
    try {
        const parse = (h) => {
            const clean = h.replace("#", "");
            return {
                r: parseInt(clean.substring(0, 2), 16) || 0,
                g: parseInt(clean.substring(2, 4), 16) || 0,
                b: parseInt(clean.substring(4, 6), 16) || 0,
            };
        };
        const c1 = parse(hex1);
        const c2 = parse(hex2);
        const dist = Math.sqrt(Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2));
        const maxDist = Math.sqrt(3 * Math.pow(255, 2)); // ~441.67
        const score = Math.max(65, Math.round((1 - dist / maxDist) * 100));
        return score;
    }
    catch {
        return 88;
    }
}
// Translate HEX color to provider-friendly color name
function hexToColorName(hex) {
    const clean = hex.replace("#", "").toLowerCase();
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    if (r > 210 && g > 210 && b > 210)
        return "white";
    if (r < 35 && g < 35 && b < 35)
        return "black";
    if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20)
        return "gray";
    if (b > r && b > g) {
        return g > 130 ? "turquoise" : "blue";
    }
    if (g > r && g > b)
        return "green";
    if (r > g && r > b) {
        if (b > 110)
            return "purple";
        if (g > 150)
            return "yellow";
        if (g > 70)
            return "orange";
        return "red";
    }
    return "blue";
}
