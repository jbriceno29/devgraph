import { createCatalog } from '../src/index.js';

export const catalog = () =>
  createCatalog([
    { sku: 'CAM-01', name: 'Camiseta básica', priceCents: 1999, category: 'ropa' },
    { sku: 'TAZ-01', name: 'Taza de cerámica', priceCents: 899, category: 'hogar' },
    { sku: 'LIB-01', name: 'Libro de cocina', priceCents: 2450, category: 'libros' },
  ]).value;
