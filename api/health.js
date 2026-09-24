export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "AI 行业晨报 → 飞书",
    schedule: "0 1 * * * (UTC)",
    beijing_time: "每天北京时间 09:00"
  });
}
