import React, { useState } from "react";

export const BMLogo = ({ size = 80, src = "/bm-logo.png", alt = "BM Printing Services" }) => {
  const [imgError, setImgError] = useState(false);

  const imgStyle = {
    width: typeof size === "number" ? size : size,
    height: typeof size === "number" ? size : size,
    objectFit: "cover",
    display: "block",
    borderRadius: "50%",
    backgroundColor: "white",
  };

  if (!imgError && src) {
    return (
      // Attempt to load the provided image (place your attached file at `public/bm-logo.png`)
      <img src={src} alt={alt} style={imgStyle} onError={() => setImgError(true)} />
    );
  }

  // Fallback to the original SVG if the image isn't available
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="60" cy="60" r="58" fill="white" stroke="#ddd" strokeWidth="2" />
      <text x="12" y="72" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="68" fill="#8B1A1A">
        B
      </text>
      <text x="52" y="72" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="68" fill="#111111">
        M
      </text>
      <text x="22" y="95" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="14" fill="#111111">
        Printing
      </text>
      <text x="60" y="95" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="14" fill="#111111">
        {" "}
        Services
      </text>
    </svg>
  );
};
