import { forwardRef, type HTMLAttributes } from "react";

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {}

const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={["custom-scrollbar", className ?? ""].join(" ").trim()}
    {...props}
  />
));

ScrollArea.displayName = "ScrollArea";

export default ScrollArea;
