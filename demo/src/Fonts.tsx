import { continueRender, delayRender, staticFile } from "remotion";
import { useEffect, useState } from "react";
import { FONT_MONO, FONT_UI } from "./tokens";

/**
 * The panel bundles Geist rather than fetching it from Google, on the grounds
 * that a product whose whole claim is "your pages go only to the model you
 * chose" should not phone home on open. The demo keeps that: the woff2 files
 * are copied into public/ and loaded from disk, same subsets, no network.
 *
 * Remotion renders in headless Chrome, so the fonts have to be *loaded* before
 * the frame is captured, not merely declared. delayRender is what holds the
 * frame open until that is true — without it the first frames render in a
 * fallback face and the render silently bakes in the wrong typography.
 */
export const Fonts: React.FC = () => {
  const [handle] = useState(() => delayRender("loading Geist"));

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @font-face {
        font-family: 'Geist';
        src: url('${staticFile("geist-latin.woff2")}') format('woff2');
        font-weight: 300 700;
        font-display: block;
      }
      @font-face {
        font-family: 'Geist Mono';
        src: url('${staticFile("geist-mono-latin.woff2")}') format('woff2');
        font-weight: 300 700;
        font-display: block;
      }
    `;
    document.head.appendChild(style);

    Promise.all([
      document.fonts.load(`700 48px ${FONT_UI}`),
      document.fonts.load(`400 24px ${FONT_MONO}`),
    ])
      .catch(() => undefined)
      .then(() => {
        document.head.removeChild(style);
        continueRender(handle);
      });
  }, [handle]);

  return null;
};
