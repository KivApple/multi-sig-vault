import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface NavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  variant: 'dock' | 'bar';
}

export const NavItem: React.FC<NavItemProps> = ({ to, label, icon, variant }) =>
  variant === 'dock' ? (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'dock-active text-primary' : '')}>
      {icon}
      <span className="dock-label">{label}</span>
    </NavLink>
  ) : (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `btn btn-sm gap-2 ${isActive ? 'btn-neutral' : 'btn-ghost'}`}
    >
      {icon}
      {label}
    </NavLink>
  );
