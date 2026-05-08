"""
Generate 3 synthetic claim documents for the insurance OCR demo.

Outputs to ./claim-documents/:
  1. auto-repair-windshield.png  — windshield damage; planted issue: glass damage
                                    is excluded under the policy. Demo wow moment:
                                    Coverage Validator catches the exclusion.
  2. auto-repair-collision.png    — collision damage; planted issue: line items
                                    sum to $4,287 but invoice claims $4,587.
                                    Demo wow moment: Validator catches the
                                    arithmetic mismatch via verify_arithmetic tool.
  3. medical-bill-clean.png       — clean ER bill, no issues. Used as the
                                    "baseline" demo run.

Run:  python generate-samples.py
Requires: pillow
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT_DIR = Path(__file__).parent / "claim-documents"
OUT_DIR.mkdir(exist_ok=True)


def _font(size: int):
    """Try common system fonts; fall back to PIL default."""
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _make_doc(filename: str, header_lines: list[str], body_lines: list[str],
              total_line: str, footer_lines: list[str]):
    W, H = 1240, 1754  # A4 at ~150 DPI
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    title_font = _font(36)
    header_font = _font(22)
    body_font = _font(20)
    big_font = _font(28)

    y = 60
    for line in header_lines:
        font = title_font if line == header_lines[0] else header_font
        draw.text((80, y), line, fill="black", font=font)
        y += 50 if line == header_lines[0] else 32
    y += 20
    draw.line([(80, y), (W - 80, y)], fill="black", width=2)
    y += 40

    for line in body_lines:
        draw.text((80, y), line, fill="black", font=body_font)
        y += 32

    y += 30
    draw.line([(80, y), (W - 80, y)], fill="black", width=1)
    y += 30
    draw.text((80, y), total_line, fill="black", font=big_font)
    y += 80

    for line in footer_lines:
        draw.text((80, y), line, fill="black", font=body_font)
        y += 30

    img.save(OUT_DIR / filename)
    print(f"wrote {OUT_DIR / filename}")


def make_auto_repair_windshield():
    _make_doc(
        "auto-repair-windshield.png",
        header_lines=[
            "MIDTOWN AUTO GLASS & BODY",
            "1248 Industrial Pkwy, Newark NJ 07105",
            "Phone: (973) 555-0142  License: NJ-AB-44291",
            "",
            "REPAIR INVOICE  #INV-2026-04-1183",
        ],
        body_lines=[
            "Date of Service: 2026-04-22",
            "Customer: Robert Chen",
            "Policy Number: POL-882-447-AC",
            "Vehicle: 2022 Toyota Camry XLE  VIN: 4T1G11AK3NU012873",
            "",
            "Damage Description: Front windshield cracked across full width.",
            "Cause: Road debris impact, highway driving.",
            "",
            "Line Items:",
            "  Windshield assembly (OEM)              $ 612.00",
            "  Wiper assembly replacement              $  84.00",
            "  Labor (3.5 hrs @ $125/hr)               $ 437.50",
            "  Calibration of ADAS camera              $ 195.00",
            "  Shop materials & disposal               $  47.50",
        ],
        total_line="TOTAL DUE:                              $1,376.00",
        footer_lines=[
            "Payment Terms: Net 30",
            "Thank you for your business.",
        ],
    )


def make_auto_repair_collision():
    # Planted issue: line items sum to 4,287; invoice claims 4,587.
    # 350 + 1240 + 720 + 540 + 412 + 815 + 210 = 4287
    # Stated total: 4,587  -> $300 discrepancy
    _make_doc(
        "auto-repair-collision.png",
        header_lines=[
            "EASTSIDE COLLISION CENTER",
            "9911 Eastside Blvd, Houston TX 77029",
            "Phone: (713) 555-0118  License: TX-CC-11873",
            "",
            "REPAIR INVOICE  #INV-2026-04-2271",
        ],
        body_lines=[
            "Date of Service: 2026-04-19",
            "Customer: Sandra Martinez",
            "Policy Number: POL-771-993-CL",
            "Vehicle: 2021 Honda CR-V EX-L  VIN: 2HKRW2H56MH604718",
            "",
            "Damage Description: Front-end collision, low speed.",
            "Cause: Rear-ended vehicle in front at intersection.",
            "",
            "Line Items:",
            "  Front bumper cover replacement          $ 350.00",
            "  Hood replacement (OEM)                  $1,240.00",
            "  Headlamp assemblies (pair)              $ 720.00",
            "  Radiator support                        $ 540.00",
            "  Paint & refinish (3 panels)             $ 412.00",
            "  Labor (8.5 hrs @ $95.88/hr)             $ 815.00",
            "  Shop materials                          $ 210.00",
        ],
        total_line="TOTAL DUE:                              $4,587.00",
        footer_lines=[
            "Payment Terms: Net 15",
            "All work guaranteed for 12 months.",
        ],
    )


def make_medical_bill_clean():
    _make_doc(
        "medical-bill-clean.png",
        header_lines=[
            "PRESBYTERIAN HOSPITAL — EMERGENCY DEPT",
            "1 Hospital Plaza, Chicago IL 60611",
            "Tax ID: 36-2167724  NPI: 1739281044",
            "",
            "PATIENT BILL OF SERVICES",
        ],
        body_lines=[
            "Date of Service: 2026-04-15",
            "Patient: James Okafor",
            "Policy Number: POL-339-228-MD",
            "Account: ACT-220-944-871",
            "Admission: ER walk-in 14:22  Discharge: 17:45",
            "",
            "Reason for Visit: Acute lower back pain following lifting injury.",
            "",
            "Charges:",
            "  Emergency dept facility fee (level 3)    $1,420.00",
            "  Physician evaluation                       $ 340.00",
            "  Lumbar X-ray (2-view)                       $ 215.00",
            "  Pharmacy: ibuprofen 800mg (10ct)            $  18.00",
            "  Pharmacy: cyclobenzaprine 10mg (10ct)       $  24.00",
        ],
        total_line="TOTAL CHARGES:                          $2,017.00",
        footer_lines=[
            "Insurance was billed primary.",
            "Patient responsibility pending insurance adjustment.",
        ],
    )


if __name__ == "__main__":
    make_auto_repair_windshield()
    make_auto_repair_collision()
    make_medical_bill_clean()
    print(f"\n3 sample documents generated in: {OUT_DIR}")
