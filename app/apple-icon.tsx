import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c0c0b",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 24 24" fill="#e9e7e2">
          <path d="M10.8 3.6A8 8 0 0 0 10.8 19.6Z" />
          <path d="M13.2 4.4A8 8 0 0 1 13.2 20.4Z" opacity="0.45" />
        </svg>
      </div>
    ),
    size,
  );
}
