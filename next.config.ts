import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ztjtkruygcchofcsbsna.supabase.co",
        // Public storage bucket only — never broaden this to private
        // object paths.
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
