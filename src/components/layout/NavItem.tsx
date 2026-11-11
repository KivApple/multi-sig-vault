import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface NavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  variant: 'dock' | 'bar';
  /** Highlight even when the route does not match (sub-pages of the section). */
  forceActive?: boolean;
}

export const NavItem: React.FC<NavItemProps> = ({ to, label, icon, variant, forceActive }) =>
  variant === 'dock' ? (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive || forceActive ? 'dock-active text-primary' : '')}>
      {icon}
      <span className="dock-label">{label}</span>
    </NavLink>
  ) : (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `btn btn-sm gap-2 ${isActive || forceActive ? 'btn-neutral' : 'btn-ghost'}`}
    >
      {icon}
      {label}
    </NavLink>
  );
