import { C } from "../../constants/colors";

export const Btn = ({ children, onClick, variant = "primary", size = "md", style: sx = {}, disabled, loading }) => {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontWeight: 600,
    borderRadius: 8,
    cursor: disabled || loading ? "not-allowed" : "pointer",
    transition: "all 0.2s",
    border: "none",
    fontFamily: "'Montserrat', sans-serif",
    opacity: disabled || loading ? 0.65 : 1
  };

  const sizes = {
    sm: { padding: "6px 14px", fontSize: 13 },
    md: { padding: "10px 22px", fontSize: 14 },
    lg: { padding: "14px 30px", fontSize: 15 }
  };

  const variants = {
    primary: { background: C.red, color: "#fff" },
    secondary: { background: "transparent", color: C.red, border: `2px solid ${C.red}` },
    ghost: { background: "transparent", color: C.gray600, border: `1px solid ${C.gray200}` },
    dark: { background: C.black, color: "#fff" },
    danger: { background: "#c62828", color: "#fff" },
    success: { background: C.success, color: "#fff" },
  };

  return (
    <button
      style={{ ...base, ...sizes[size], ...variants[variant], ...sx }}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading && (
        <span
          style={{
            width: 14,
            height: 14,
            border: "2px solid rgba(255,255,255,0.4)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite",
            display: "inline-block"
          }}
        />
      )}
      {children}
    </button>
  );
};
