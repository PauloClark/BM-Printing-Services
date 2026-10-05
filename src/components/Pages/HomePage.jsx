import { useEffect, useRef, useState } from "react";
import { C } from "../../constants/colors";
import { PRODUCTS } from "../../constants/products";
import { HomeHero } from "./HomeHero";
import { BMLogo } from "../Common/BMLogo";
import { Card } from "../Common/Card";
import "./HomePage.css";

// Home preview assets only; shared product records and other pages remain unchanged.
const HOME_CUTOUTS = {
  1: 'tshirt-cutout.png', 2: 'polo-cutout.png', 3: 'hoodie-cutout.png',
  4: 'school-id-cutout.png', 5: 'banner-cutout.png', 9: 'mug-cutout.png', 11: 'sticker-cutout.png'
};

const HIDDEN_PRODUCT_NAMES = new Set([
  "Tote Bag Printing",
  "Tarpaulin Printing (per sqm)",
  "Pull-Up / Roll-Up Banner",
  "Keychain / Button Pin",
  "Event Backdrop / Streamer"
]);

const BENEFITS = [
  ["01", "QUALITY PRINTING", "Clean and reliable printing for your personal, school, business, and event needs."],
  ["02", "AFFORDABLE OPTIONS", "Printing solutions for different project requirements and quantities."],
  ["03", "CUSTOM DESIGNS", "Submit your preferred design or reference for customized printing."],
  ["04", "EASY ORDER PROCESS", "Place and track your orders through the website."]
];

const ORDER_STEPS = [
  ["01", "Choose a Product", "Browse the available BM Printing services."],
  ["02", "Customize Your Order", "Select quantity, size, color, dimensions, or other applicable specifications."],
  ["03", "Upload Your Design", "Upload a design or reference when required for the selected product."],
  ["04", "Confirm Your Order", "Review the order information, total price, and payment method."],
  ["05", "Track Your Order", "Follow the order status while BM Printing staff processes it."]
];

const shortDescription = description => {
  const firstSentence = String(description || "").split(/[.!?](?:\s|$)/)[0];
  return firstSentence ? `${firstSentence}.` : "Made to order for your printing needs.";
};

export const HomePage = ({ setPage, reviews }) => {
  const [products, setProducts] = useState(() => PRODUCTS.filter(product => !HIDDEN_PRODUCT_NAMES.has(product.name)));
  const [processVisible, setProcessVisible] = useState(false);
  const [processStatic, setProcessStatic] = useState(false);
  const processSectionRef = useRef(null);

  useEffect(() => {
    const section = processSectionRef.current;
    if (!section) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setProcessStatic(true);
      setProcessVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setProcessVisible(true);
      observer.disconnect();
    }, { threshold: 0.3 });

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/products")
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!active || !Array.isArray(data?.products) || data.products.length === 0) return;
        const availableProducts = data.products
          .filter(product => !HIDDEN_PRODUCT_NAMES.has(product.name))
          .map(product => {
            const local = PRODUCTS.find(item => Number(item.id) === Number(product.id));
            return {
              ...local,
              ...product,
              id: product.id ?? local?.id,
              name: product.name,
              image: local?.image || product.image || "",
              imageFit: local?.imageFit || "contain",
              description: product.description || local?.description || ""
            };
          });
        setProducts(availableProducts);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Repeat only rendered cards if the catalog is unusually short, so one group
  // always covers the viewport. Two identical groups make the loop seamless.
  const previewProducts = products.length
    ? Array.from({ length: Math.max(1, Math.ceil(4 / products.length)) }, () => products).flat()
    : [];

  return (
    <div className="fade-in bm-home-page">
      <HomeHero setPage={setPage} />

      <section className="bm-home-section bm-home-services" aria-labelledby="home-services-title">
        <div className="bm-home-section__inner">
          <header className="bm-home-section__heading">
            <span className="bm-home-eyebrow">OUR SERVICES</span>
            <h2 id="home-services-title">Everything You Need, Printed Your Way.</h2>
            <p>Explore our printing services for apparel, business materials, personalized items, and custom projects.</p>
          </header>
          <div className="bm-home-conveyor" aria-label="Printing services">
            <div className="bm-home-conveyor__track">
              {[0, 1].map(copy => (
                <div className="bm-home-conveyor__group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                  {previewProducts.map((product, index) => (
                    <article className="bm-home-service" key={product.id + '-' + index}>
                      <div className="bm-home-service__image">
                        {(HOME_CUTOUTS[product.id] || product.image) && <img
                          src={HOME_CUTOUTS[product.id] ? '/image/hero/products/cutouts/' + HOME_CUTOUTS[product.id] : product.image}
                          alt={copy === 0 ? product.name : ''} decoding="async" />}
                      </div>
                      <div className="bm-home-service__body">
                        <span className="bm-home-service__category">{product.category || "Printing Services"}</span>
                        <h3>{product.name}</h3>
                        <p>{shortDescription(product.description)}</p>
                        <button type="button" className="bm-home-text-link" tabIndex={copy === 1 ? -1 : undefined} onClick={() => setPage("products")}>
                          View Product <span aria-hidden="true">&rarr;</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="bm-home-section__action">
            <button type="button" className="bm-home-button bm-home-button--outline" onClick={() => setPage("products")}>
              Browse All Products
            </button>
          </div>
        </div>
      </section>

      <section className="bm-home-section bm-home-benefits" aria-labelledby="home-benefits-title">
        <div className="bm-home-section__inner">
          <header className="bm-home-section__heading">
            <span className="bm-home-eyebrow">MADE FOR YOUR PROJECT</span>
            <h2 id="home-benefits-title">Why Choose BM Printing Services?</h2>
          </header>
          <div className="bm-home-benefits__grid">
            {BENEFITS.map(([number, title, description]) => (
              <article className="bm-home-benefit" key={title}>
                <span className="bm-home-benefit__number">{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        ref={processSectionRef}
        className={`bm-home-section bm-home-process${processVisible ? " bm-home-process--visible" : ""}${processStatic ? " bm-home-process--static" : ""}`}
        aria-labelledby="home-process-title"
      >
        <div className="bm-home-section__inner">
          <header className="bm-home-section__heading bm-home-section__heading--center">
            <span className="bm-home-eyebrow">HOW IT WORKS</span>
            <h2 id="home-process-title">From Your Idea to the Final Print</h2>
          </header>
          <ol className="bm-home-process__grid">
            {ORDER_STEPS.map(([number, title, description]) => (
              <li className="bm-home-process__step" key={number}>
                <span className="bm-home-process__number">{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {reviews && reviews.length > 0 && (
        <div className="bm-home-reviews" style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 24px" }}>
          <h2
            style={{
              fontFamily: "Montserrat",
              fontWeight: 800,
              fontSize: 28,
              textAlign: "center",
              marginBottom: 32
            }}
          >
            What Our Customers Say
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 20
            }}
          >
            {reviews.slice(0, 6).map((r, i) => (
              <Card key={i}>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    marginBottom: 12
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: C.red,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 16,
                      flexShrink: 0
                    }}
                  >
                    {r.name[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div>
                    <div style={{ color: "#f59e0b", fontSize: 14 }}>
                      {"★".repeat(r.rating)}
                      {"☆".repeat(5 - r.rating)}
                    </div>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 14,
                    color: C.gray600,
                    lineHeight: 1.6,
                    fontStyle: "italic"
                  }}
                >
                  "{r.comment}"
                </p>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
                  {r.product} · {r.date}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <section className="bm-home-cta" aria-labelledby="home-cta-title">
        <div className="bm-home-cta__inner">
          <div>
            <span className="bm-home-eyebrow bm-home-eyebrow--light">LET'S MAKE IT</span>
            <h2 id="home-cta-title">Ready to Print Your Idea?</h2>
            <p>Choose a printing service, customize your order, and let BM Printing Services handle the rest.</p>
          </div>
          <div className="bm-home-cta__actions">
            <button type="button" className="bm-home-button bm-home-button--light" onClick={() => setPage("products")}>
              Browse Products
            </button>
            <button type="button" className="bm-home-button bm-home-button--dark" onClick={() => setPage("order")}>
              Order Now
            </button>
          </div>
        </div>
      </section>

      <footer
        style={{
          background: "#0a0a0a",
          color: "rgba(255,255,255,0.6)",
          padding: "32px 24px",
          textAlign: "center",
          fontSize: 13
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 12
          }}
        >
          <BMLogo size={30} />
          <span
            style={{
              color: "#fff",
              fontWeight: 700,
              fontFamily: "Montserrat"
            }}
          >
            BM Printing Services
          </span>
        </div>
        <p>facebook.com/BMprintingshop · Philippines</p>
        <p style={{ marginTop: 8 }}>© 2018 BM Printing Services. All rights reserved.</p>
      </footer>
    </div>
  );
};
