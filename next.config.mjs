/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Ensure the CSV files ship with the admin route so GET-from-disk works on
    // Vercel. If this ever fails to find the files, the route's POST path
    // (paste CSV text) always works regardless.
    outputFileTracingIncludes: {
      "/api/admin/load": ["./data/**"],
    },
  },
};

export default nextConfig;
