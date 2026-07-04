import { motion, HTMLMotionProps } from "framer-motion";
import { ReactNode } from "react";

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  hover?: boolean;
}

export function GlassCard({ children, hover = true, className = "", ...rest }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`glass-card ${hover ? "glass-card-hover" : ""} p-6 ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
