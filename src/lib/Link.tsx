import type { MouseEvent, ReactNode } from "react";
import { navigate } from "../router";

export function Link({
  to,
  replace,
  className,
  children,
  onClick,
}: {
  to: string;
  replace?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onClick?.();
        navigate(to, { replace });
      }}
    >
      {children}
    </a>
  );
}