import { useEffect, useRef, useState } from "react";
import { BMLogo } from "../Common/BMLogo";
import "./HomeHero.css";

// Desktop uses straight rectangular source windows, independent of the red
// dividers. Preserve the existing source masks for the mobile carousel only.
const services = [
  { id: "sticker", title: "STICKER", subtitle: "Decals & Labels", desktopCrop: "410 140 310 527", crop: "255 140 585 527", outline: "255,140 678,140 838,667 418,667" },
  { id: "offset", title: "OFFSET", subtitle: "Printing", desktopCrop: "830 140 330 527", crop: "678 140 620 527", outline: "678,140 1133,140 1296,667 838,667" },
  { id: "signage", title: "SIGNAGE", subtitle: "Maker", desktopCrop: "1250 140 330 527", crop: "1133 140 606 527", outline: "1133,140 1576,140 1737,667 1296,667" },
  { id: "tshirt", title: "T-SHIRT", subtitle: "Printing", desktopCrop: "1718 140 330 527", crop: "1576 140 472 527", outline: "1576,140 2048,140 2048,667 1737,667" },
];

export const HomeHero = ({ setPage }) => {
  const [activeSlide, setActiveSlide] = useState(0);
  const activeRef = useRef(0);
  const trackRef = useRef(null);
  const showSlide = (index) => {
    const next = (index + services.length) % services.length;
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({
      left: next * track.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };

  useEffect(() => {
    const track = trackRef.current;
    // Keep the selected slide aligned when DevTools or device rotation resizes
    // the viewport; clear the scroll offset when returning to the desktop banner.
    const observer = new ResizeObserver(() => {
      track.scrollLeft = window.innerWidth < 768 ? activeRef.current * track.clientWidth : 0;
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  return (
  <section className="bm-hero" aria-labelledby="bm-hero-title">
    <h1 className="bm-hero-sr-only" id="bm-hero-title">
      BM Printing Services — Stickers, Offset, Signage & T-Shirt Printing
    </h1>
    <div className="bm-hero-stage">
      <div className="bm-hero-brand">
        <BMLogo size="100%" />
      </div>
      <div
        className="bm-hero-panels"
        id="bm-service-panels"
        ref={trackRef}
        onScroll={(event) => {
          if (window.innerWidth >= 768) return;
          const track = event.currentTarget;
          const index = Math.max(0, Math.min(services.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
          activeRef.current = index;
          setActiveSlide(index);
        }}
      >
        {services.map(({ id, title, subtitle, desktopCrop, crop, outline }) => (
          <div className={`bm-hero-panel bm-hero-panel--${id}`} key={id}>
            <div className="bm-hero-panel-content">
              <svg className="bm-hero-photo bm-hero-photo--desktop" viewBox={desktopCrop} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
                <image href="/bm-facebook-cover.jpg" width="2048" height="780" preserveAspectRatio="xMinYMin meet" />
              </svg>
              <svg className="bm-hero-photo bm-hero-photo--mobile" viewBox={crop} preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
                <defs>
                  <clipPath id={`bm-photo-${id}`}>
                    <polygon points={outline} />
                  </clipPath>
                </defs>
                <image href="/bm-facebook-cover.jpg" width="2048" height="780" preserveAspectRatio="xMinYMin meet" clipPath={`url(#bm-photo-${id})`} />
              </svg>
              <div className="bm-hero-photo-shade" />
              <h2 className="bm-hero-service">
                <span>{title}</span>
                <small>{subtitle}</small>
              </h2>
            </div>
          </div>
        ))}
      </div>
      <div className="bm-hero-dividers" aria-hidden="true"><i /><i /><i /></div>
    </div>

    <div className="bm-hero-carousel-controls" role="group" aria-label="Service slides">
      <button type="button" onClick={() => showSlide(activeSlide - 1)} aria-label="Previous service" aria-controls="bm-service-panels">←</button>
      <span aria-live="polite" aria-atomic="true">{services[activeSlide].title} <small>{activeSlide + 1} / {services.length}</small></span>
      <button type="button" onClick={() => showSlide(activeSlide + 1)} aria-label="Next service" aria-controls="bm-service-panels">→</button>
    </div>

    <div className="bm-hero-contact">
      <address className="bm-hero-address">
        <strong>BM PRINTING SERVICES</strong>
        <a href="mailto:bmprintingservices11@gmail.com">bmprintingservices11@gmail.com</a>
        <span>Brgy. Leon Garcia, Agdao, Davao City</span>
      </address>
      <a className="bm-hero-phone" href="tel:+639083045001">
        <span>Smart</span><strong>0908-304-5001</strong>
      </a>
      <a className="bm-hero-phone" href="tel:+639772490286">
        <span>Globe</span><strong>0977-249-0286</strong>
      </a>
      <div className="bm-hero-extras">
        <span>We also accept:</span><strong>Rush ID / Photocopy</strong>
      </div>
    </div>

  </section>
  );
};
