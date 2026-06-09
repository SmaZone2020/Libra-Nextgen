import {
  NavbarBrand,
  NavbarContent,
  NavbarHeader,
  NavbarItem,
  NavbarLabel,
  NavbarMenu,
  NavbarMenuItem,
  NavbarMenuToggle,
  NavbarRoot,
  NavbarSeparator,
  NavbarSpacer,
} from './navbar';

export { useNavbar } from './navbar';
export { navbarVariants } from './navbar.styles';

const Navbar = Object.assign(NavbarRoot, {
  Brand: NavbarBrand,
  Content: NavbarContent,
  Header: NavbarHeader,
  Item: NavbarItem,
  Label: NavbarLabel,
  Menu: NavbarMenu,
  MenuItem: NavbarMenuItem,
  MenuToggle: NavbarMenuToggle,
  Root: NavbarRoot,
  Separator: NavbarSeparator,
  Spacer: NavbarSpacer,
});

export {
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarHeader,
  NavbarItem,
  NavbarLabel,
  NavbarMenu,
  NavbarMenuItem,
  NavbarMenuToggle,
  NavbarRoot,
  NavbarSeparator,
  NavbarSpacer,
};

export type {
  NavbarBrandProps,
  NavbarContentProps,
  NavbarHeaderProps,
  NavbarItemProps,
  NavbarLabelProps,
  NavbarMenuItemProps,
  NavbarMenuProps,
  NavbarMenuToggleProps,
  NavbarNavigate,
  NavbarRootProps as NavbarProps,
  NavbarRootProps,
  NavbarSeparatorProps,
  NavbarSpacerProps,
} from './navbar';
export type { NavbarVariants } from './navbar.styles';
