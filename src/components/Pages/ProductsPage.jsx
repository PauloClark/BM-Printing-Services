import { useState, useEffect } from "react";

import { PRODUCTS } from "../../constants/products";

import { Btn } from "../Common/Btn";
import "./ProductsPage.css";

const REMOVED_PRODUCT_NAMES = new Set([
  "Tote Bag Printing",
  "Tarpaulin Printing (per sqm)",
  "Pull-Up / Roll-Up Banner",
  "Keychain / Button Pin",
  "Event Backdrop / Streamer"
]);

export const ProductsPage = ({ setPage, setSelectedProduct }) => {
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [dbProducts, setDbProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch("/api/products");
        if (response.ok) {
          const data = await response.json();
          if (data.products && data.products.length > 0) {
            const merged = data.products.map(dp => {
              const local = PRODUCTS.find(lp => lp.id === dp.id);
              return {
                id: dp.id,
                name: dp.name,
                price: local?.price ?? dp.price,
                image: local?.image || dp.image || "",
                imageFit: local?.imageFit || "contain",
                description: dp.description || local?.description || "",
                minQty: dp.minQty || local?.minQty || 1,
                category: dp.category || local?.category || "Printing",
                stock: dp.stock || 0,
                lowStockThreshold: dp.lowStockThreshold || 10,
                status: dp.status || "Active",
                unit: local?.unit || "per piece",
                popular: local?.popular || false
              };
            });
            setDbProducts(merged);
          } else {
            setDbProducts(PRODUCTS);
          }
        } else {
          setDbProducts(PRODUCTS);
        }
      } catch {
        setDbProducts(PRODUCTS);
      }
      setLoadingProducts(false);
    };
    fetchProducts();
  }, []);

  const displayProducts = (dbProducts.length > 0 ? dbProducts : PRODUCTS).filter(
    product => !REMOVED_PRODUCT_NAMES.has(product.name)
  );
  const filtered = displayProducts.filter(
    p =>
      (cat === "All" || p.category === cat) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()))
  );

  const categories = [...new Set(displayProducts.map(product => product.category))];
  return (
    <main className="bm-catalog" aria-labelledby="bm-catalog-title">
      <div className="bm-catalog__decoration" aria-hidden="true" />
      <div className="bm-catalog__inner">
        <header className="bm-catalog__intro">
          <div className="bm-catalog__heading">
            <p className="bm-catalog__eyebrow">OUR PRODUCTS</p>
            <h1 id="bm-catalog-title">Printing <span>Solutions</span></h1>
            <p className="bm-catalog__subtitle">High quality prints for your business, school, and personal needs.</p>
          </div>
          <div className="bm-catalog__controls" role="search" aria-label="Find products">
            <div className="bm-catalog__search">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
              <input type="search" aria-label="Search products" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." />
            </div>
            <select aria-label="Product category" value={cat} onChange={e => setCat(e.target.value)}>
              <option value="All">All Categories</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
        </header>
        <div className="bm-catalog__results" role="status" aria-live="polite">
          {loadingProducts ? 'Loading products...' : `${filtered.length} ${filtered.length === 1 ? 'product' : 'products'}${cat !== 'All' ? ' in ' + cat : ' to make your own'}`}
        </div>
        <div className="bm-catalog__grid" aria-busy={loadingProducts}>
          {filtered.map(p => (
            <article key={p.id} className="bm-catalog__card">
              {p.popular && <span className="bm-catalog__popular">POPULAR</span>}
              <div className="bm-catalog__image">
                {p.image && <img src={p.image} alt={p.name} loading="lazy" decoding="async" />}
              </div>
              <div className="bm-catalog__content">
                <p className="bm-catalog__category">{p.category}</p>
                <h2>{p.name}</h2>
                <p className="bm-catalog__description">{p.description}</p>
                <div className="bm-catalog__purchase">
                  <p className="bm-catalog__price">&#8369;{p.price.toLocaleString()}</p>
                  <p className="bm-catalog__unit">{p.unit || "per piece"} &middot; min. {p.minQty} pcs</p>
                  {p.stock !== undefined && p.stock <= (p.lowStockThreshold || 10) && (
                    <p className={`bm-catalog__stock${p.stock === 0 ? ' bm-catalog__stock--empty' : ''}`}>
                      {p.stock === 0 ? "Out of Stock" : `Low Stock: ${p.stock} left`}
                    </p>
                  )}
                  <Btn size="sm" style={{ minHeight: 44, padding: "10px 20px" }} onClick={() => {
                    setSelectedProduct(p);
                    setPage("order");
                  }}>Order <span aria-hidden="true">&rarr;</span></Btn>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!loadingProducts && filtered.length === 0 && (
          <div className="bm-catalog__empty">
            <h2>No products found.</h2>
            <p>Try a different search or category.</p>
            <button onClick={() => { setSearch(""); setCat("All"); }}>Clear filters</button>
          </div>
        )}
      </div>
    </main>
  );
};