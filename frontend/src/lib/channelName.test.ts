import { describe, it, expect } from "vitest";
import { normalizeChannelName, normalizeChannelNameInput } from "./channelName";

describe("normalizeChannelName", () => {
  it("keeps ASCII letters/numbers and hyphenates spaces", () => {
    expect(normalizeChannelName("General Chat")).toBe("general-chat");
    expect(normalizeChannelName("  random   talk  ")).toBe("random-talk");
    expect(normalizeChannelName("news-2026")).toBe("news-2026");
  });

  it("keeps Turkish lowercase letters", () => {
    expect(normalizeChannelName("çğışöü")).toBe("çğışöü");
    expect(normalizeChannelName("şelale")).toBe("şelale");
  });

  it("keeps Turkish uppercase letters (ç ğ ı İ ö ş ü)", () => {
    expect(normalizeChannelName("ŞELALE")).toBe("şelale");
    // ASCII "I" lowercases to "i" (locale-independent, like Discord) while the
    // Turkish dotless "ı" and dotted "İ" both keep their own lowercase forms.
    expect(normalizeChannelName("ÇĞIÖŞÜ")).toBe("çğiöşü");
    expect(normalizeChannelName("ÇĞİÖŞÜ")).toBe("çğiöşü");
    // "İ".toLowerCase() is "i" + U+0307; the combining dot is dropped.
    expect(normalizeChannelName("İSTANBUL")).toBe("istanbul");
  });

  it("supports mixed Turkish/ASCII names with spaces", () => {
    expect(normalizeChannelName("Genel Sohbet Odası")).toBe("genel-sohbet-odası");
    expect(normalizeChannelName("Dünya Gündemi!")).toBe("dünya-gündemi");
  });

  it("strips punctuation, emoji and repeated/edge hyphens", () => {
    expect(normalizeChannelName("hello!!!")).toBe("hello");
    expect(normalizeChannelName("a 🎉 b")).toBe("a-b");
    expect(normalizeChannelName("a --- b")).toBe("a-b");
    expect(normalizeChannelName("-genel-")).toBe("genel");
    expect(normalizeChannelName("!!!")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeChannelName("Çok  Güzel #Kanal!");
    expect(normalizeChannelName(once)).toBe(once);
  });
});

describe("normalizeChannelNameInput", () => {
  it("keeps the trailing hyphen so a second word can be typed", () => {
    expect(normalizeChannelNameInput("genel ")).toBe("genel-");
    expect(normalizeChannelNameInput("genel s")).toBe("genel-s");
  });

  it("keeps Turkish characters while typing", () => {
    expect(normalizeChannelNameInput("Şe")).toBe("şe");
    expect(normalizeChannelNameInput("Çığ ")).toBe("çığ-");
  });

  it("drops leading hyphens from leading whitespace", () => {
    expect(normalizeChannelNameInput("  genel")).toBe("genel");
  });
});
