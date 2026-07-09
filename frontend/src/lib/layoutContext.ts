import { createContext, useContext } from 'react';

interface LayoutCtx {
  openMobileMenu: () => void;
}

export const LayoutContext = createContext<LayoutCtx>({ openMobileMenu: () => {} });
export const useLayout = () => useContext(LayoutContext);
