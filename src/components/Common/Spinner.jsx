import { C } from "../../constants/colors";

export const Spinner = ({ size = 32 }) => (
  <div
    style={{
      width: size,
      height: size,
      border: `3px solid ${C.gray200}`,
      borderTopColor: C.red,
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite"
    }}
  />
);
