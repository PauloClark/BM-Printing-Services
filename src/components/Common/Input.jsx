import { C } from "../../constants/colors";

export const Input = ({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  options,
  style: sx = {},
  rows,
  min,
  max,
  step
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {label && (
      <label style={{ fontSize: 13, fontWeight: 600, color: C.gray600 }}>
        {label}
        {required && <span style={{ color: C.red }}> *</span>}
      </label>
    )}
    {type === "select" ? (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: "10px 14px",
          border: `1.5px solid ${C.gray200}`,
          borderRadius: 8,
          fontSize: 14,
          background: C.white,
          ...sx
        }}
      >
        <option value="">Select...</option>
        {options?.map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    ) : type === "textarea" ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows || 3}
        style={{
          padding: "10px 14px",
          border: `1.5px solid ${C.gray200}`,
          borderRadius: 8,
          fontSize: 14,
          resize: "vertical",
          ...sx
        }}
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        style={{
          padding: "10px 14px",
          border: `1.5px solid ${C.gray200}`,
          borderRadius: 8,
          fontSize: 14,
          ...sx
        }}
      />
    )}
  </div>
);
