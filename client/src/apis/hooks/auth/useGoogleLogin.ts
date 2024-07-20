import { useQueryClient } from "@tanstack/react-query";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import Firebase from "../../../integrations/firebase";
import { useAuthStore } from "../../../store/auth";

export const GOOGLE_LOGIN = "GOOGLE_LOGIN_Q_KEY" as const;

export const useAuth = () => {
  const queryClient = useQueryClient();
  const { setLogout } = useAuthStore();
  return {
    signIn: () =>
      queryClient.ensureQueryData({
        queryKey: [GOOGLE_LOGIN],
        queryFn: async () => {
          try {
            await signInWithPopup(Firebase.auth, new GoogleAuthProvider());
          } catch (error) {
            await Firebase.auth.signOut();
          }
        },
      }),
    signOut: async () => {
      await Firebase.auth.signOut();
      setLogout();
    },
  };
};