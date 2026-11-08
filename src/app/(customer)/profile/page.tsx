import type { Metadata } from "next";
import { ProfileScreen } from "@/components/customer/profile/profile-screen";

export const metadata: Metadata = {
  title: "Akun",
  description: "Profil, kampus, notifikasi, dan pengaturan akun Sisa-Saji.",
};

export default function ProfilePage() {
  return <ProfileScreen />;
}
