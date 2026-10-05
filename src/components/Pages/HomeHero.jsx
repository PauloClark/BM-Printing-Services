import "./HomeHero.css";

const assets = '/image/hero/products/cutouts/';
const showcase = [
  ['tshirt', 'tshirt-cutout.png', 'Custom printed jersey'],
  ['polo', 'polo-cutout.png', 'BM Printing polo shirts'],
  ['hoodie', 'hoodie-cutout.png', 'Custom printed hoodie'],
  ['banner', 'banner-cutout.png', 'Printed signage'],
  ['sticker', 'sticker-cutout.png', 'Die-cut stickers'],
  ['id', 'school-id-cutout.png', 'School IDs and lanyards'],
  ['mug', 'mug-cutout.png', 'Personalized printed mugs']
];
const services = [
  ['apparel', 'APPAREL', 'PRINTING', 'M8 4 3 7l3 5 3-2v11h12V10l3 2 3-5-5-3c-1 4-8 4-9 0Z'],
  ['offset', 'OFFSET', 'PRINTING', 'M8 11V3h14v8M8 22H4V11h22v11h-4M8 18h14v9H8ZM22 14h1'],
  ['signage', 'SIGNAGE', 'MAKER', 'M6 3h18v21H6ZM4 27h22M9 24v3M21 24v3M10 8h10M10 12h7'],
  ['sticker', 'STICKER', 'PRINTING', 'M5 4h20v13L15 27H5ZM15 27V17h10']
];

export const HomeHero = ({ setPage }) => (
  <section className="bm-ad-hero" aria-labelledby="bm-ad-title">
    <div className="bm-ad-hero__stage">
      <div className="bm-ad-hero__geometry" aria-hidden="true" />
      <div className="bm-ad-hero__inner">
        <div className="bm-ad-hero__message">
          <h1 id="bm-ad-title">
            <span className="bm-ad-hero__your">YOUR</span>
            <span className="bm-ad-hero__trusted">TRUSTED</span>
            <span className="bm-ad-hero__partner">PRINTING PARTNER</span>
          </h1>
          <p className="bm-ad-hero__tagline">Quality Prints for Every Need.</p>
        </div>
        <div className="bm-ad-hero__showcase" role="group" aria-label="Real BM Printing products">
          <div className="bm-ad-hero__platform" aria-hidden="true" />
          <div className="bm-ad-hero__stand">
            <strong>YOUR IDEAS<br /><span>OUR PRINTS</span></strong>
            <ul>{['Tarpaulin', 'Stickers', 'Signage', 'ID Printing', 'Sublimation'].map(service => <li key={service}>{service}</li>)}</ul>
          </div>
          {showcase.map(([type, file, alt]) => <img key={type} className={`bm-ad-hero__product bm-ad-hero__product--${type}`} src={assets + file} alt={alt} decoding="async" />)}
        </div>
        <nav className="bm-ad-hero__services" aria-label="Explore printing services">
          {services.map(([id, title, subtitle, icon]) => (
            <button type="button" key={id} onClick={() => setPage('products')}>
              <span className="bm-ad-hero__icon"><svg viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg></span>
              <span>{title}<br />{subtitle}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
    <div className="bm-ad-hero__contact">
      <a href="mailto:bmprintingservices11@gmail.com">bmprintingservices11@gmail.com</a>
      <span>Brgy. Leon Garcia, Agdao, Davao City</span>
      <a href="tel:+639083045001">SMART 0908-304-5001</a>
      <a href="tel:+639772490286">GLOBE 0977-249-0286</a>
      <span>Rush ID / Photocopy</span>
    </div>
  </section>
);