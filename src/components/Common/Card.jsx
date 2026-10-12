import { C } from "../../constants/colors";

export const Card = ({ children, style: sx = {}, className = "" }) => (
  <div
    className={className}
    style={{
      background: `var(--bm-card-background, ${C.white})`,
      borderRadius: 12,
      border: `1px solid var(--bm-card-border, ${C.gray200})`,
      padding: "20px 24px",
      transition: "transform 0.2s, box-shadow 0.2s",
      ...sx
    }}
  >
    {children}
  </div>
);
