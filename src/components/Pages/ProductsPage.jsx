import { useState, useEffect } from "react";
import { C } from "../../constants/colors";
import { PRODUCTS, CATEGORIES } from "../../constants/products";
import { Card } from "../Common/Card";
import { Btn } from "../Common/Btn";

const CATEGORY_ICONS = {
  "All": "📦",
  "Clothing & Apparel": "👕",
  "School Supplies": "🪪",
  "Tarpaulins & Banners": "🖼️",
  "Promotional Items": "☕"
};

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
                price: dp.price,
                image: dp.image || local?.image || "📦",
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

  const displayProducts = dbProducts.length > 0 ? dbProducts : PRODUCTS;
  const filtered = displayProducts.filter(
    p =>
      (cat === "All" || p.category === cat) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description.toLowerCase().includes(search.toLowerCase()))
  );

  const dynamicCategories = ["All", ...new Set(displayProducts.map(p => p.category).filter(Boolean))];

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "40px 24px"
      }}
      className="fade-in"
    >
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "Montserrat",
            fontWeight: 800,
            fontSize: 30,
            marginBottom: 8
          }}
        >
          Our Products
        </h1>
        <p style={{ color: C.gray600 }}>
          Browse our full catalog of custom printing services
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
          alignItems: "center"
        }}
      >
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products..."
          style={{
            padding: "10px 16px",
            border: `1.5px solid ${C.gray200}`,
            borderRadius: 8,
            fontSize: 14,
            flex: 1,
            minWidth: 200
          }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {dynamicCategories.map(c => (
            <button
              key={c}
              onClick={() => setCat(c)}
              style={{
                padding: "8px 16px",
                borderRadius: 20,
                border: `1.5px solid ${cat === c ? C.red : C.gray200}`,
                background: cat === c ? C.red : C.white,
                color: cat === c ? "#fff" : C.gray600,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loadingProducts && (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.gray400 }}>
          Loading products...
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 20
        }}
      >
        {filtered.map(p => (
          <Card
            key={p.id}
            className="card-hover"
            style={{ position: "relative" }}
          >
            {p.popular && (
              <div
                style={{
                  position: "absolute",
                  top: 16,
                  right: 16,
                  background: C.red,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 12
                }}
              >
                POPULAR
              </div>
            )}
            {p.image && p.image.startsWith("data:") ? (
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <img src={p.image} alt={p.name} style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 8 }} />
              </div>
            ) : (
              <div style={{ fontSize: 48, marginBottom: 12, textAlign: "center" }}>
                {p.image || "📦"}
              </div>
            )}
            <div
              style={{
                fontSize: 11,
                color: C.red,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 4
              }}
            >
              {p.category}
            </div>
            <h3
              style={{
                fontFamily: "Montserrat",
                fontWeight: 700,
                fontSize: 16,
                marginBottom: 8
              }}
            >
              {p.name}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: C.gray600,
                lineHeight: 1.6,
                marginBottom: 16
              }}
            >
              {p.description}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end"
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "Montserrat",
                    fontWeight: 800,
                    fontSize: 22,
                    color: C.red
                  }}
                >
                  ₱{p.price.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: C.gray400 }}>
                  {p.unit || "per piece"} · min. {p.minQty} pcs
                </div>
                {p.stock !== undefined && p.stock <= (p.lowStockThreshold || 10) && (
                  <div style={{ fontSize: 11, color: p.stock === 0 ? "#c62828" : C.warning, fontWeight: 600, marginTop: 2 }}>
                    {p.stock === 0 ? "Out of Stock" : `Low Stock: ${p.stock} left`}
                  </div>
                )}
              </div>
              <Btn
                size="sm"
                onClick={() => {
                  setSelectedProduct(p);
                  setPage("order");
                }}
              >
                Order →
              </Btn>
            </div>
          </Card>
        ))}
      </div>

      {!loadingProducts && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.gray400 }}>
          No products found.
        </div>
      )}
    </div>
  );
};
