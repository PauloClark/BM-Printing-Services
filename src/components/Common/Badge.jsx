import { displayOrderStatus } from '../../../shared/orderWorkflow';
import { C } from "../../constants/colors";
import { STATUS_COLORS } from "../../constants/products";

export const Badge = ({ status }) => {
  status = displayOrderStatus(status);
  const s = STATUS_COLORS[status] || STATUS_COLORS["Pending"];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}
    >
      {status}
    </span>
  );
};
