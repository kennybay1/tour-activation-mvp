import FanPage from "./fan-page";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <FanPage slug={slug} />;
}
