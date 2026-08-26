import { useEffect } from "react";
import { C } from "../../constants/colors";

export const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = {
    success: { bg: C.success, icon: "✓" },
    error: { bg: "#c62828", icon: "✕" },
    info: { bg: C.info, icon: "ℹ" }
  };
  const c = colors[type] || colors.info;

  return (
    <div
      style={{
        position: "fixed",
        top: 24,
        right: 24,
        zIndex: 9999,
        background: c.bg,
        color: "#fff",
        padding: "14px 20px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        maxWidth: 360,
        animation: "slideIn 0.3s ease"
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{c.icon}</span>
      <span style={{ flex: 1 }}>{message}</span>
      <span style={{ cursor: "pointer", marginLeft: 8, opacity: 0.7 }} onClick={onClose}>
        ✕
      </span>
    </div>
  );
};
