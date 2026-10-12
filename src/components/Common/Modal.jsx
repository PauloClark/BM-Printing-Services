import { C } from "../../constants/colors";
import { Card } from "./Card";

export const Modal = ({ open, onClose, title, children, width = 500 }) => {
  if (!open) return null;

  return (
    <div
      className="bm-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bm-modal-dialog"
        style={{
          background: `var(--bm-modal-background, ${C.white})`,
          borderRadius: 16,
          width: "100%",
          maxWidth: width,
          maxHeight: "90vh",
          overflow: "auto",
          animation: "fadeIn 0.2s ease"
        }}
      >
        <div
          className="bm-modal-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px 24px",
            borderBottom: `1px solid ${C.gray200}`
          }}
        >
          <h3 style={{ fontFamily: "Montserrat", fontWeight: 700, fontSize: 18 }}>
            {title}
          </h3>
          <button
            type="button"
            className="bm-modal-close"
            aria-label="Close dialog"
            onClick={onClose}
            style={{
              display: "inline-grid",
              placeItems: "center",
              flex: "0 0 auto",
              width: 36,
              height: 36,
              padding: 0,
              boxSizing: "border-box",
              background: "var(--bm-modal-close-background, transparent)",
              border: "1px solid var(--bm-modal-close-border, transparent)",
              borderRadius: 8,
              cursor: "pointer",
              color: `var(--bm-modal-close-color, ${C.gray400})`,
              lineHeight: 0
            }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="bm-modal-body" style={{ padding: "20px 24px" }}>{children}</div>
      </div>
    </div>
  );
};
