import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // setup dev server on mobile
  allowedDevOrigins: ['192.168.31.131'],
};

export default withNextIntl(nextConfig);
