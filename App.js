/** Bear Like — client direct OwpenGram, Expo SDK 55.
 * Compte natif, publications épinglées au profil et conversations OwpenGram.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert as RNAlert,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image as NativeImage,
  KeyboardAvoidingView,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as ImageManipulator from "expo-image-manipulator";
import { AudioModule, RecordingPresets, useAudioRecorder, useAudioPlayer, useAudioPlayerStatus, useAudioRecorderState, setAudioModeAsync } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
// API moderne expo-file-system : téléchargement vers le cache avant ajout à la galerie.
// Les URI du sélecteur sont temporaires et peuvent expirer.
import * as FS from "expo-file-system/legacy";
import { Image as NativeExpoImage } from "expo-image";
import { randomUUID } from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
const {preparePhotoFile} = require("./lib/media-file");
import OwpenGramAuth from "./components/OwpengramAuth";
const {authClient, accountNamespace} = require("./lib/owpengram-auth");
const owpenApi = require("./lib/owpengram-api");
const {useMediaUri} = require("./lib/owpengram-media");

function ResolvedImage({source, style, nativeExpo=false, ...props}) {
  const original = typeof source === "object" && !Array.isArray(source) ? source?.uri : null;
  const resolved = useMediaUri(original, !!original);
  const opaque = typeof original === "string" && original.startsWith("owp-media://");
  if (opaque && !resolved.uri) return <Pressable accessibilityLabel={resolved.error ? "Réessayer le média" : "Chargement du média"} onPress={resolved.error ? resolved.retry : undefined} style={[style,{alignItems:"center",justifyContent:"center",backgroundColor:"#132238"}]}>{resolved.loading ? <ActivityIndicator color="#25F4EE"/> : <RNText style={{color:"#c8d2df",fontSize:11}}>Média indisponible</RNText>}</Pressable>;
  const Component = nativeExpo ? NativeExpoImage : NativeImage;
  return <Component {...props} style={style} source={opaque ? {...source,uri:resolved.uri} : source}/>;
}
function Image(props) { return <ResolvedImage {...props}/>; }
function ExpoImage(props) { return <ResolvedImage {...props} nativeExpo/>; }

const BEAR_LANG_KEY = "@bear-like-language-v1";
let bearLanguage = "fr";

const BEAR_GRID_KEY = "@bear-like-explorer-columns-v1";
const BEAR_THEMES = ["navy", "dark", "white"];
const BEAR_COLUMNS = [2, 3, 4];
function useBearPreference(key, fallback, allowed) {
  const [value, setValue] = useState(fallback);
  const touched = useRef(false), writes = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key).then(raw => {
      const restored = typeof fallback === "number" ? Number(raw) : raw;
      if (live && !touched.current && allowed.includes(restored)) setValue(restored);
    }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  const choose = next => {
    if (!allowed.includes(next)) return;
    touched.current = true; setValue(next);
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(key, String(next)));
    writes.current.catch(() => Alert.alert("Bear Like", "Impossible d’enregistrer la préférence. Réessaie."));
  };
  return [value, choose];
}

const BEAR_TRANSLATIONS = {
  "Vidéo indisponible": ["Video unavailable", "Vídeo no disponible"],
  "+ Suivre": ["+ Follow", "+ Seguir"],
  "Affichage des publications": ["Post layout", "Diseño de publicaciones"],
  "Dialogues": ["Chats", "Chats"],
  "Messages sauvegardés": ["Saved messages", "Mensajes guardados"],
  "Aucune conversation trouvée": ["No conversations found", "No se encontraron conversaciones"],
  "Aujourd’hui": ["Today", "Hoy"],
  "Aujourd'hui": ["Today", "Hoy"],
  "Options du message": ["Message options", "Opciones del mensaje"],
  "Transférer vers": ["Forward to", "Reenviar a"],
  "Les commentaires sont désactivés pour cette publication.": ["Comments are disabled for this post.", "Los comentarios están desactivados para esta publicación."],
  "Remplacer": ["Replace", "Reemplazar"],
  "Son de l’aperçu": ["Preview sound", "Sonido de vista previa"],
  "Qui peut voir cette publication ?": ["Who can see this post?", "¿Quién puede ver esta publicación?"],
  "Changer la photo ou la vidéo": ["Change photo or video", "Cambiar foto o vídeo"],
  "Vues du profil": ["Profile views", "Visitas al perfil"],
  "Historique des vues du profil": ["Profile view history", "Historial de visitas al perfil"],
  "Activer les vues du profil": ["Enable profile views", "Activar visitas al perfil"],
  "Chargement…": ["Loading…", "Cargando…"],
  "Partager la publication": ["Share post", "Compartir publicación"],
  "Gérer la publication": ["Manage post", "Gestionar publicación"],
  "Choisir une photo": ["Choose a photo", "Elegir una foto"],
  "Pas encore de suggestions disponibles": ["No suggestions available yet", "Todavía no hay sugerencias disponibles"],
  "Passer cette étape": ["Skip this step", "Omitir este paso"],
  "Terminer et accéder à Bear Like": ["Finish and open Bear Like", "Terminar y entrar en Bear Like"],
  "Voir le profil": ["View profile", "Ver perfil"],
  "Plus d’options": ["More options", "Más opciones"],
  "Plus d'options": ["More options", "Más opciones"],
  "Rechercher une conversation": ["Search conversations", "Buscar conversaciones"],
  "Rechercher dans cette discussion": ["Search this chat", "Buscar en este chat"],
  "Rechercher des vidéos, des créateurs…": ["Search videos, creators…", "Buscar vídeos, creadores…"],
  "Pièce jointe": ["Attachment", "Archivo adjunto"],
  "Impossible d’ouvrir ce média.": ["Unable to open this media.", "No se puede abrir este archivo."],
  "Impossible d'ouvrir ce média.": ["Unable to open this media.", "No se puede abrir este archivo."],
  "Document": ["Document", "Documento"],
  "Audio": ["Audio", "Audio"],
  "Contact": ["Contact", "Contacto"],
  "Position": ["Location", "Ubicación"],
  "Fichiers": ["Files", "Archivos"],
  "Appel": ["Call", "Llamada"],
  "Activer": ["Enable", "Activar"],
  "Désactiver": ["Disable", "Desactivar"],
  "Confirmer": ["Confirm", "Confirmar"],
  "Erreur": ["Error", "Error"],
  "Réessayer": ["Retry", "Reintentar"],
  "Envoyé": ["Sent", "Enviado"],
  "Publication privée": ["Private post", "Publicación privada"],
  "Amis sélectionnés": ["Selected friends", "Amigos seleccionados"],
  "Sélectionner des amis": ["Select friends", "Seleccionar amigos"],
  "Liste de suivis": ["Following list", "Lista de seguidos"],
  "Fond d’écran": ["Wallpaper", "Fondo de pantalla"],
  "Centre d’aide": ["Help center", "Centro de ayuda"],
  "Pas de compte ?": ["No account?", "¿No tienes cuenta?"],
  "Ne plus suivre": ["Unfollow", "Dejar de seguir"],
  "Choisi": ["Selected", "Seleccionado"],
  "Compte privé": ["Private account", "Cuenta privada"],
  "Notifications du profil": ["Profile notifications", "Notificaciones del perfil"],
  "Mentions": ["Mentions", "Menciones"],
  "Messages directs": ["Direct messages", "Mensajes directos"],
  "Téléchargements": ["Downloads", "Descargas"],
  "Mode Light": ["Light mode", "Modo claro"],
  "Écrire un commentaire…": ["Write a comment…", "Escribe un comentario…"],
  "Aucun commentaire": ["No comments", "No hay comentarios"],
  "Photo": ["Photo", "Foto"],
  "Vidéo": ["Video", "Vídeo"],
  "Galerie": ["Gallery", "Galería"],
  "Profil modifié": ["Profile updated", "Perfil actualizado"],
  "Hors ligne": ["Offline", "Desconectado"],
  "Suggérés": ["Suggested", "Sugeridos"],
  "Suivis ▾": ["Following ▾", "Siguiendo ▾"],
  "J’aime": ["Likes", "Me gusta"],
  "Profil public": ["Public profile", "Perfil público"],
  "Suivre en retour": ["Follow back", "Seguir también"],

  "Accueil": [
    "Home",
    "Inicio"
  ],
  "Explorer": [
    "Explore",
    "Explorar"
  ],
  "Messages": [
    "Messages",
    "Mensajes"
  ],
  "Profil": [
    "Profile",
    "Perfil"
  ],
  "Publications": [
    "Posts",
    "Publicaciones"
  ],
  "Publication": [
    "Post",
    "Publicación"
  ],
  "Suivis": [
    "Following",
    "Siguiendo"
  ],
  "Followers": [
    "Followers",
    "Seguidores"
  ],
  "Abonnements": [
    "Following",
    "Siguiendo"
  ],
  "Pour toi": [
    "For You",
    "Para ti"
  ],
  "Amis": [
    "Friends",
    "Amigos"
  ],
  "Suggéré": [
    "Suggested",
    "Sugeridos"
  ],
  "Suggestions": [
    "Suggestions",
    "Sugerencias"
  ],
  "Suivre": [
    "Follow",
    "Seguir"
  ],
  "Suivi": [
    "Following",
    "Siguiendo"
  ],
  "Abonné": [
    "Following",
    "Siguiendo"
  ],
  "Se désabonner": [
    "Unfollow",
    "Dejar de seguir"
  ],
  "J'aime": [
    "Likes",
    "Me gusta"
  ],
  "Commentaires": [
    "Comments",
    "Comentarios"
  ],
  "Commenter": [
    "Comment",
    "Comentar"
  ],
  "Partager": [
    "Share",
    "Compartir"
  ],
  "Republications": [
    "Reposts",
    "Republicaciones"
  ],
  "Reposter": [
    "Repost",
    "Republicar"
  ],
  "Publier": [
    "Publish",
    "Publicar"
  ],
  "Publier localement": [
    "Publish locally",
    "Publicar localmente"
  ],
  "Brouillons": [
    "Drafts",
    "Borradores"
  ],
  "Nouvelle publication": [
    "New post",
    "Nueva publicación"
  ],
  "Modifier": [
    "Edit",
    "Editar"
  ],
  "Supprimer": [
    "Delete",
    "Eliminar"
  ],
  "Annuler": [
    "Cancel",
    "Cancelar"
  ],
  "Enregistrer": [
    "Save",
    "Guardar"
  ],
  "Terminé": [
    "Done",
    "Listo"
  ],
  "Suivant": [
    "Next",
    "Siguiente"
  ],
  "Continuer": [
    "Continue",
    "Continuar"
  ],
  "Retour": [
    "Back",
    "Volver"
  ],
  "Fermer": [
    "Close",
    "Cerrar"
  ],
  "Rechercher": [
    "Search",
    "Buscar"
  ],
  "Tout": [
    "All",
    "Todo"
  ],
  "Vidéos": [
    "Videos",
    "Vídeos"
  ],
  "Photos": [
    "Photos",
    "Fotos"
  ],
  "Comptes": [
    "Accounts",
    "Cuentas"
  ],
  "Comptes suggérés": [
    "Suggested accounts",
    "Cuentas sugeridas"
  ],
  "Voir tout ›": [
    "See all ›",
    "Ver todo ›"
  ],
  "Identifiant": [
    "Username",
    "Usuario"
  ],
  "Mot de passe": [
    "Password",
    "Contraseña"
  ],
  "Confirmer le mot de passe": [
    "Confirm password",
    "Confirmar contraseña"
  ],
  "Connexion": [
    "Login",
    "Iniciar sesión"
  ],
  "Inscription": [
    "Sign up",
    "Registrarse"
  ],
  "Créer ton compte": [
    "Create your account",
    "Crea tu cuenta"
  ],
  "Connecte-toi à ton compte": [
    "Log in to your account",
    "Inicia sesión en tu cuenta"
  ],
  "Créer mon compte": [
    "Create my account",
    "Crear mi cuenta"
  ],
  "Se connecter": [
    "Log in",
    "Iniciar sesión"
  ],
  "Inscrits": [
    "Registered",
    "Registrados"
  ],
  "● En ligne": [
    "● Online",
    "● En línea"
  ],
  "En ligne": [
    "Online",
    "En línea"
  ],
  "Déjà un compte ? ": [
    "Already have an account? ",
    "¿Ya tienes cuenta? "
  ],
  "Pas encore de compte ? ": [
    "Don't have an account? ",
    "¿No tienes cuenta? "
  ],
  "Ton identifiant Bear Like": [
    "Your Bear Like username",
    "Tu usuario de Bear Like"
  ],
  "Ton mot de passe": [
    "Your password",
    "Tu contraseña"
  ],
  "Répète ton mot de passe": [
    "Repeat your password",
    "Repite tu contraseña"
  ],
  "6 caractères minimum": [
    "6 characters minimum",
    "Mínimo 6 caracteres"
  ],
  "Paramètres et confidentialité": [
    "Settings and privacy",
    "Configuración y privacidad"
  ],
  "Compte": [
    "Account",
    "Cuenta"
  ],
  "Sécurité et autorisations": [
    "Security and permissions",
    "Seguridad y permisos"
  ],
  "Partager le profil": [
    "Share profile",
    "Compartir perfil"
  ],
  "Visibilité": [
    "Visibility",
    "Visibilidad"
  ],
  "Comptes bloqués": [
    "Blocked accounts",
    "Cuentas bloqueadas"
  ],
  "Interactions": [
    "Interactions",
    "Interacciones"
  ],
  "Vidéos aimées": [
    "Liked videos",
    "Vídeos que te gustan"
  ],
  "Vues": [
    "Views",
    "Visualizaciones"
  ],
  "Contenu et affichage": [
    "Content and display",
    "Contenido y pantalla"
  ],
  "Boîte de réception et messagerie": [
    "Inbox and messaging",
    "Bandeja de entrada y mensajes"
  ],
  "Contrôle du public": [
    "Audience controls",
    "Control de audiencia"
  ],
  "Publicités": [
    "Ads",
    "Anuncios"
  ],
  "Lecture": [
    "Playback",
    "Reproducción"
  ],
  "Afficher": [
    "Display",
    "Pantalla"
  ],
  "Langue": [
    "Language",
    "Idioma"
  ],
  "Accessibilité": [
    "Accessibility",
    "Accesibilidad"
  ],
  "Contacts et localisation": [
    "Contacts and location",
    "Contactos y ubicación"
  ],
  "Cache et données mobiles": [
    "Cache and mobile data",
    "Caché y datos móviles"
  ],
  "Vidéos hors ligne": [
    "Offline videos",
    "Vídeos sin conexión"
  ],
  "Libérer de l'espace": [
    "Free up space",
    "Liberar espacio"
  ],
  "Économiseur de données": [
    "Data saver",
    "Ahorro de datos"
  ],
  "Fond d'écran": [
    "Wallpaper",
    "Fondo de pantalla"
  ],
  "Assistance et informations": [
    "Support and information",
    "Ayuda e información"
  ],
  "Centre d'aide": [
    "Help center",
    "Centro de ayuda"
  ],
  "Centre de confidentialité": [
    "Privacy center",
    "Centro de privacidad"
  ],
  "Conditions et politiques": [
    "Terms and policies",
    "Términos y políticas"
  ],
  "Changer de compte": [
    "Switch account",
    "Cambiar de cuenta"
  ],
  "Se déconnecter": [
    "Log out",
    "Cerrar sesión"
  ],
  "Thème": [
    "Theme",
    "Tema"
  ],
  "Choisir l’apparence de Bear Like": [
    "Choose Bear Like's appearance",
    "Elige la apariencia de Bear Like"
  ],
  "Bleu nuit": [
    "Midnight blue",
    "Azul noche"
  ],
  "Français": [
    "French",
    "Francés"
  ],
  "English": [
    "English",
    "Inglés"
  ],
  "Español": [
    "Spanish",
    "Español"
  ],
  "Activé": [
    "Enabled",
    "Activado"
  ],
  "Désactivé": [
    "Disabled",
    "Desactivado"
  ],
  "Tout le monde": [
    "Everyone",
    "Todos"
  ],
  "Moi uniquement": [
    "Only me",
    "Solo yo"
  ],
  "Lecture automatique": [
    "Autoplay",
    "Reproducción automática"
  ],
  "Lecture manuelle": [
    "Manual playback",
    "Reproducción manual"
  ],
  "Aucune publication": [
    "No posts",
    "Sin publicaciones"
  ],
  "Aucun message": [
    "No messages",
    "Sin mensajes"
  ],
  "Aucun résultat": [
    "No results",
    "Sin resultados"
  ],
  "Envoyer": [
    "Send",
    "Enviar"
  ],
  "Répondre": [
    "Reply",
    "Responder"
  ],
  "Copier": [
    "Copy",
    "Copiar"
  ],
  "Épingler": [
    "Pin",
    "Fijar"
  ],
  "Archiver": [
    "Archive",
    "Archivar"
  ],
  "Signaler": [
    "Report",
    "Denunciar"
  ],
  "Bloquer": [
    "Block",
    "Bloquear"
  ],
  "Photo de profil": [
    "Profile photo",
    "Foto de perfil"
  ],
  "Date de naissance": [
    "Date of birth",
    "Fecha de nacimiento"
  ],
  "Pays": [
    "Country",
    "País"
  ],
  "France": [
    "France",
    "Francia"
  ],
  "États-Unis": [
    "United States",
    "Estados Unidos"
  ],
  "Espagne": [
    "Spain",
    "España"
  ],
  "Bienvenue sur Bear Like": [
    "Welcome to Bear Like",
    "Bienvenido a Bear Like"
  ],
  "Personnalise ton profil": [
    "Customize your profile",
    "Personaliza tu perfil"
  ],
  "Découvrir des comptes": [
    "Discover accounts",
    "Descubrir cuentas"
  ],
  "Passer": [
    "Skip",
    "Omitir"
  ],
  "Terminer": [
    "Finish",
    "Finalizar"
  ],
  "Publique": [
    "Public",
    "Pública"
  ],
  "Privée": [
    "Private",
    "Privada"
  ],
  "Certains amis": [
    "Selected friends",
    "Algunos amigos"
  ],
  "Visibilité locale": [
    "Local visibility",
    "Visibilidad local"
  ],
  "Fil local": [
    "Local feed",
    "Feed local"
  ],
  "Autoriser les commentaires": [
    "Allow comments",
    "Permitir comentarios"
  ],
  "Aperçu": [
    "Preview",
    "Vista previa"
  ],
  "Description": [
    "Description",
    "Descripción"
  ],
  "Modifier le profil": [
    "Edit profile",
    "Editar perfil"
  ],
  "Nom": [
    "Name",
    "Nombre"
  ],
  "Bio": [
    "Bio",
    "Biografía"
  ],
  "Modifier la photo": [
    "Change photo",
    "Cambiar foto"
  ],
  "Suivant ›": [
    "Next ›",
    "Siguiente ›"
  ],
  "Enregistrer les modifications": [
    "Save changes",
    "Guardar cambios"
  ],
  "Demande envoyée": [
    "Request sent",
    "Solicitud enviada"
  ],
  "Accepter": [
    "Accept",
    "Aceptar"
  ],
  "Refuser": [
    "Decline",
    "Rechazar"
  ],
  "Demander à suivre": [
    "Request to follow",
    "Solicitar seguir"
  ],
  "Notifications": [
    "Notifications",
    "Notificaciones"
  ],
  "Recherche": [
    "Search",
    "Búsqueda"
  ],
  "Tout afficher": [
    "Show all",
    "Mostrar todo"
  ],
  "Vidéos aimées et vues": [
    "Liked and viewed videos",
    "Vídeos que te gustan y vistos"
  ]
};
Object.assign(BEAR_TRANSLATIONS, {
  "Aperçu indisponible": [
    "Preview unavailable",
    "Vista previa no disponible"
  ],
  "Aucun ami disponible pour le moment. Les vrais comptes seront proposés après synchronisation des abonnements avec le serveur.": [
    "No friends available yet. Real accounts will appear after following is synced with the server.",
    "Aún no hay amigos disponibles. Las cuentas reales aparecerán tras sincronizar los seguidos con el servidor."
  ],
  "Aucun autre compte disponible pour le moment.": [
    "No other accounts available yet.",
    "Todavía no hay otras cuentas disponibles."
  ],
  "Aucun e-mail ni numéro demandé. Conserve bien ton identifiant et ton mot de passe : la récupération du compte n'est pas encore disponible.": [
    "No email or phone number required. Keep your username and password safe: account recovery is not available yet.",
    "No se pide correo ni teléfono. Guarda tu usuario y contraseña: la recuperación de cuentas aún no está disponible."
  ],
  "Aucun média trouvé": [
    "No media found",
    "No se encontraron archivos"
  ],
  "Aucune notification": [
    "No notifications",
    "No hay notificaciones"
  ],
  "Aucune publication publique": [
    "No public posts",
    "No hay publicaciones públicas"
  ],
  "Aucune visite vérifiée pour le moment.": [
    "No verified visits yet.",
    "Todavía no hay visitas verificadas."
  ],
  "Autorise l’accès à tes photos pour afficher ta galerie ici.": [
    "Allow access to your photos to display your gallery here.",
    "Permite el acceso a tus fotos para mostrar tu galería aquí."
  ],
  "Ces abonnements seront enregistrés sur le serveur à la fin de l'inscription.": [
    "These follows will be saved on the server when registration is complete.",
    "Estos seguidos se guardarán en el servidor al terminar el registro."
  ],
  "Ces informations sont enregistrées sur ce téléphone pour le moment. La date de naissance ne sera pas affichée publiquement.": [
    "This information is currently stored on this phone. Your date of birth will not be shown publicly.",
    "Esta información se guarda por ahora en este teléfono. La fecha de nacimiento no será pública."
  ],
  "Cette rubrique est préparée dans l'interface. Sa fonction réelle nécessitera une intégration supplémentaire à Bear Like.": [
    "This section is prepared in the interface. Its functionality needs further integration into Bear Like.",
    "Esta sección está preparada en la interfaz. Su función requiere una integración adicional en Bear Like."
  ],
  "Choisir avec Android": [
    "Choose with Android",
    "Elegir con Android"
  ],
  "Effacer la sélection": [
    "Clear selection",
    "Borrar selección"
  ],
  "Elle sera supprimée de ton profil et du fil public. Cette action est irréversible.": [
    "It will be removed from your profile and public feed. This action cannot be undone.",
    "Se eliminará de tu perfil y del feed público. Esta acción es irreversible."
  ],
  "Envoyez un message pour dire bonjour.": [
    "Send a message to say hello.",
    "Envía un mensaje para saludar."
  ],
  "Espace personnel": [
    "Personal space",
    "Espacio personal"
  ],
  "Gestion du compte": [
    "Account management",
    "Gestión de cuenta"
  ],
  "Le serveur ne propose pas encore de classement des comptes populaires. Tu pourras découvrir des comptes plus tard dans Explorer.": [
    "The server does not yet provide a popular accounts ranking. You can discover accounts later in Explore.",
    "El servidor aún no ofrece una clasificación de cuentas populares. Podrás descubrir cuentas en Explorar."
  ],
  "Le thème choisi est conservé après fermeture de Bear Like. Les vidéos restent en plein écran.": [
    "Your theme is saved after closing Bear Like. Videos remain full screen.",
    "El tema se guarda al cerrar Bear Like. Los vídeos siguen a pantalla completa."
  ],
  "Les 100 visiteurs les plus récents sont affichés. Le badge compte tous les visiteurs éligibles.": [
    "The 100 most recent visitors are shown. The badge counts all eligible visitors.",
    "Se muestran los 100 visitantes más recientes. El indicador cuenta todos los visitantes elegibles."
  ],
  "Les deux comptes doivent activer cette option. Le badge compte les visiteurs distincts des 30 derniers jours. Désactiver efface tes visites et ton historique ; réactiver commence une nouvelle période.": [
    "Both accounts must enable this option. The badge counts distinct visitors over the last 30 days. Disabling clears your visits and history; enabling again starts a new period.",
    "Ambas cuentas deben activar esta opción. El indicador cuenta visitantes distintos de los últimos 30 días. Desactivar borra tus visitas e historial; reactivar inicia un nuevo período."
  ],
  "Les nouveaux likes, abonnements et commentaires apparaîtront ici lorsqu'ils seront transmis par le serveur.": [
    "New likes, follows and comments will appear here when received from the server.",
    "Los nuevos me gusta, seguidores y comentarios aparecerán aquí al recibirse del servidor."
  ],
  "Lien du profil": [
    "Profile link",
    "Enlace del perfil"
  ],
  "L’historique des vues du profil est désactivé.": [
    "Profile view history is disabled.",
    "El historial de visitas al perfil está desactivado."
  ],
  "Message": [
    "Message",
    "Mensaje"
  ],
  "Message vocal": [
    "Voice message",
    "Mensaje de voz"
  ],
  "Conversations OwpenGram · actualiser pour recevoir": [
    "Messages synced with Bear Like · refresh to receive",
    "Mensajes sincronizados con Bear Like · actualiza para recibir"
  ],
  "Modifier le mot de passe": [
    "Change password",
    "Cambiar contraseña"
  ],
  "Nouveaux comptes": [
    "New accounts",
    "Cuentas nuevas"
  ],
  "Ouverture de ta galerie…": [
    "Opening your gallery…",
    "Abriendo tu galería…"
  ],
  "Ouvrir la galerie du téléphone": [
    "Open phone gallery",
    "Abrir galería del teléfono"
  ],
  "Pas encore de messages ici…": [
    "No messages here yet…",
    "Todavía no hay mensajes aquí…"
  ],
  "Préférence enregistrée sur ce téléphone. Elle ne s'applique pas encore aux autres utilisateurs ni au serveur.": [
    "Preference saved on this phone. It does not yet apply to other users or the server.",
    "Preferencia guardada en este teléfono. Aún no se aplica a otros usuarios ni al servidor."
  ],
  "Publication à reprendre • Appuie ici": [
    "Post to resume • Tap here",
    "Publicación pendiente • Toca aquí"
  ],
  "Statut indisponible": [
    "Status unavailable",
    "Estado no disponible"
  ],
  "Story": [
    "Story",
    "Historia"
  ],
  "Supprimer définitivement cette publication ?": [
    "Permanently delete this post?",
    "¿Eliminar definitivamente esta publicación?"
  ],
  "Supprimer mon compte": [
    "Delete my account",
    "Eliminar mi cuenta"
  ],
  "Sélectionner des amis (": [
    "Select friends (",
    "Seleccionar amigos ("
  ],
  "Tranche d'âge préférée": [
    "Preferred age range",
    "Rango de edad preferido"
  ],
  "Tranche d'âge préférée :": [
    "Preferred age range:",
    "Rango de edad preferido:"
  ],
  "abonnés": [
    "followers",
    "seguidores"
  ],
  "ans": [
    "years",
    "años"
  ],
  "commentaire": [
    "comment",
    "comentario"
  ],
  "média": [
    "media",
    "archivo"
  ],
  "média(s) ·": [
    "media ·",
    "archivos ·"
  ],
  "↪ Transféré de": [
    "↪ Forwarded from",
    "↪ Reenviado de"
  ],
  "📎 Média indisponible — réouvrir la discussion": [
    "📎 Media unavailable — reopen the chat",
    "📎 Archivo no disponible — vuelve a abrir el chat"
  ],
  "Découvrir des comptes": [
    "Discover accounts",
    "Descubrir cuentas"
  ],
  "Découverte indisponible. Appuie pour réessayer.": [
    "Discovery unavailable. Tap to retry.",
    "Descubrimiento no disponible. Toca para reintentar."
  ],
  "Historique indisponible. Appuie pour réessayer.": [
    "History unavailable. Tap to retry.",
    "Historial no disponible. Toca para reintentar."
  ],
  "Préférence non enregistrée. Réessaie.": [
    "Preference not saved. Try again.",
    "Preferencia no guardada. Reintenta."
  ],
  "Impossible d’enregistrer la préférence. Réessaie.": [
    "Unable to save your preference. Try again.",
    "No se pudo guardar la preferencia. Reintenta."
  ],
  "Bleu nuit": [
    "Midnight blue",
    "Azul noche"
  ],
  "White": [
    "Light",
    "Claro"
  ],
  "Dark": [
    "Dark",
    "Oscuro"
  ],
  "Comptes suggérés": [
    "Suggested accounts",
    "Cuentas sugeridas"
  ],
  "Voir tout ›": [
    "See all ›",
    "Ver todo ›"
  ],
  "Créer": [
    "Create",
    "Crear"
  ]
});
Object.assign(BEAR_TRANSLATIONS, {"· aperçu sans découpe du fichier":["· preview without trimming the file","· vista previa sin recortar el archivo"]});
Object.assign(BEAR_TRANSLATIONS, {
  "Choisir un format": [
    "Choose a format",
    "Elegir un formato"
  ],
  "Média indisponible": [
    "Media unavailable",
    "Archivo no disponible"
  ],
  "Actualiser": [
    "Refresh",
    "Actualizar"
  ],
  "Sélectionner": [
    "Select",
    "Seleccionar"
  ],
  "Désélectionner": [
    "Deselect",
    "Deseleccionar"
  ],
  "Charger plus": [
    "Load more",
    "Cargar más"
  ],
  "Retirer cette photo": [
    "Remove this photo",
    "Quitar esta foto"
  ],
  "Préparation des médias…": [
    "Preparing media…",
    "Preparando archivos…"
  ],
  "Sélectionne une seule photo ou vidéo.": [
    "Select up to 20 photos.",
    "Selecciona hasta 20 fotos."
  ],
  "Sélectionne une seule photo ou vidéo.": [
    "Select one video or up to 20 photos, without mixing them.",
    "Selecciona un solo vídeo o hasta 20 fotos, sin mezclarlos."
  ],
  "Ce fichier n’est plus accessible. Choisis-le avec la galerie du téléphone ou vérifie les autorisations.": [
    "This file is no longer accessible. Choose it with the phone gallery or check permissions.",
    "Este archivo ya no es accesible. Elígelo con la galería del teléfono o revisa los permisos."
  ],
  "Accès limité : seuls les médias autorisés sont affichés. Utilise la galerie du téléphone pour en choisir d’autres.": [
    "Limited access: only permitted media are shown. Use the phone gallery to choose others.",
    "Acceso limitado: solo se muestran los archivos autorizados. Usa la galería del teléfono para elegir otros."
  ]
});
function bearTranslate(value) {
  if (typeof value !== "string" || !["en", "es"].includes(bearLanguage)) return value;
  const entry = BEAR_TRANSLATIONS[value];
  if (entry) return entry[bearLanguage === "en" ? 0 : 1];
  const match = value.match(/^(\s*)(.*?)(\s*)$/s);
  if (match && BEAR_TRANSLATIONS[match[2]]) return match[1] + BEAR_TRANSLATIONS[match[2]][bearLanguage === "en" ? 0 : 1] + match[3];
  const normalized = value.trim().replace(/\s+/g," ");
  if (BEAR_TRANSLATIONS[normalized]) return BEAR_TRANSLATIONS[normalized][bearLanguage === "en" ? 0 : 1];
  return value;
}
function translateChildren(children) {
  if (typeof children === "string") return bearTranslate(children);
  if (Array.isArray(children)) return children.map(translateChildren);
  return children;
}
function Text({ children, ...props }) { return <RNText {...props}>{translateChildren(children)}</RNText>; }
const HashtagContext=React.createContext(null);
function HashtagText({children,...props}) {
  const open=React.useContext(HashtagContext);
  if(typeof children!=='string'||!open)return <Text {...props}>{children}</Text>;
  const parts=[];let last=0;
  for(const match of children.matchAll(/(^|[^\p{L}\p{N}\p{M}_])(#(?:[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*))/gu)) {
    const start=match.index+match[1].length,tag=match[2];
    parts.push(children.slice(last,start));
    parts.push(<RNText key={start} accessibilityRole="link" accessibilityLabel={`Rechercher ${tag}`} style={{color:CYAN}} onPress={event=>{event.stopPropagation?.();open(tag);}}>{tag}</RNText>);
    last=start+tag.length;
  }
  parts.push(children.slice(last));return <Text {...props}>{parts}</Text>;
}
const BearFormContext=React.createContext(null);
function BearFormScroll({children,...props}) {
  const scroll=useRef(null),focused=useRef(null),timer=useRef(null);
  const reveal=useCallback(target=>{
    if(target)focused.current=target;
    clearTimeout(timer.current);
    timer.current=setTimeout(()=>{if(!focused.current)return;try{scroll.current?.getScrollResponder()?.scrollResponderScrollNativeHandleToKeyboard(focused.current,36,true);}catch(_){}},80);
  },[]);
  useEffect(()=>{const show=Keyboard.addListener('keyboardDidShow',()=>reveal());const hide=Keyboard.addListener('keyboardDidHide',()=>{focused.current=null;clearTimeout(timer.current);});return()=>{show.remove();hide.remove();clearTimeout(timer.current);};},[reveal]);
  return <BearFormContext.Provider value={reveal}><ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} {...props} ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onLayout={e=>{props.onLayout?.(e);if(focused.current)reveal();}}>{children}</ScrollView></BearFormContext.Provider>;
}

function TextInput({ placeholder, onFocus, onContentSizeChange, ...props }) {
  const reveal=React.useContext(BearFormContext);
  return <RNTextInput {...props} placeholder={bearTranslate(placeholder)} onFocus={e=>{reveal?.(e.nativeEvent.target);onFocus?.(e);}} onContentSizeChange={e=>{if(props.multiline)reveal?.();onContentSizeChange?.(e);}} />;
}

// Traduire également les boîtes de dialogue natives et leurs boutons.
const Alert = {
  ...RNAlert,
  alert(title, message, buttons, options) {
    const localizedButtons = Array.isArray(buttons) ? buttons.map(button => ({
      ...button, text: bearTranslate(button.text)
    })) : buttons;
    return RNAlert.alert(bearTranslate(title), bearTranslate(message), localizedButtons, options);
  }
};

const RED = "#FE2C55";
const CYAN = "#25F4EE";
// Identifiants stables conservés avec les brouillons avant toute tentative réseau.
const uid = () => randomUUID();
const compact = (n) =>
  n >= 1000000
    ? (n / 1000000).toFixed(1) + " M"
    : n >= 1000
      ? (n / 1000).toFixed(1) + " k"
      : String(n || 0);
const clock = (n) =>
  `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;
const pic = (id, w = 600) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
// Aucun compte ou média fictif intégré à l'application.
const USERS = {};
const DEMOS = [];
const DEMO_IDS = new Set(["studio", "nature", "voyage"]);
const cleanDemoState = (state) => {
  const d = { ...state };
  d.posts = (d.posts || []).filter(p => p && !DEMO_IDS.has(p.author) && !String(p.id || "").startsWith("demo"));
  d.following = (d.following || []).filter(id => !DEMO_IDS.has(id));
  d.liked = (d.liked || []).filter(id => !String(id).startsWith("demo"));
  d.saved = (d.saved || []).filter(id => !String(id).startsWith("demo"));
  d.reposts = (d.reposts || []).filter(id => !String(id).startsWith("demo"));
  d.comments = Object.fromEntries(Object.entries(d.comments || {}).filter(([id]) => !String(id).startsWith("demo")));
  d.chats = Object.fromEntries(Object.entries(d.chats || {}).filter(([id]) => !DEMO_IDS.has(id)));
  d.chatMeta = Object.fromEntries(Object.entries(d.chatMeta || {}).filter(([id]) => !DEMO_IDS.has(id)));
  d.notifications = (d.notifications || []).filter(n => n && !DEMO_IDS.has(n.userId) && !DEMO_IDS.has(n.fromUserId) && !String(n.postId || "").startsWith("demo"));
  return d;
};

const initialState = () => ({
  profile: {
    id: "me",
    name: "Mon profil",
    handle: "mon.profil",
    bio: "Bienvenue dans mon univers ✨",
    avatar: null,
    followers: 0,
  },
  posts: [],
  drafts: [],
  liked: [],
  saved: [],
  reposts: [],
  following: [],
  comments: {},
  chats: {},
  chatMeta: {},
});

function Icon({ name, size = 24, color = s.bold.color }) {
  return <Ionicons name={name} size={size} color={color} />;
}
function Tap({ children, onPress, style, label, disabled, ...rest }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { opacity: 0.55 }]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}
function Button({ title, onPress, secondary, disabled, style, textColor }) {
  title = bearTranslate(title);
  return (
    <Tap
      label={title}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, style]}
    >
      <Text style={[s.buttonText, secondary && { color: s.bold.color }, textColor && { color: textColor }]}>
        {title}
      </Text>
    </Tap>
  );
}
// Avatar video: silent, looping preview. Expo Video is already a Bear Like dependency.
function AvatarVideo({ uri, size }) {
  const resolved = useMediaUri(uri);
  uri = String(uri || "").startsWith("owp-media://") ? resolved.uri : uri;
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    player.muted = true;
    player.loop = true;
    player.play();
    return () => { try { player.pause(); } catch (_) {} };
  }, [player]);
  return <VideoView player={player} nativeControls={false} contentFit="cover" style={{ width: size, height: size }} />;
}

function Avatar({ user, size = 48, onPress }) {
  return (
    <Tap
      label={`Profil de ${user?.name || "cet utilisateur"}`}
      onPress={onPress}
      disabled={!onPress}
      style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      {user?.avatar && user?.avatarType === "video" ? (
        <AvatarVideo uri={user.avatar} size={size} />
      ) : user?.avatar ? (
        <Image source={{ uri: user.avatar }} style={{ width: size, height: size }} />
      ) : (
        <Icon name="person" size={size * 0.52} color="#777" />
      )}
    </Tap>
  );
}
function Empty({ icon = "videocam-outline", title, body, action, onPress }) {
  return (
    <View style={s.empty}>
      <Icon name={icon} size={45} color="#999" />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.muted}>{body}</Text>
      {action && (
        <Button title={action} onPress={onPress} style={{ marginTop: 22 }} />
      )}
    </View>
  );
}
function Header({ title, onBack, right }) {
  title = bearTranslate(title);
  return (
    <View style={s.header}>
      <View style={{ width: 44 }}>
        {onBack && (
          <Tap onPress={onBack} label="Retour" style={s.iconButton}>
            <Icon name="chevron-back" />
          </Tap>
        )}
      </View>
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ minWidth: 44 }}>{right}</View>
    </View>
  );
}

// One player per mounted card; only the visible card plays. Hooks release players.
function Movie({
  uri,
  active,
  fit = "cover",
  controls = false,
  onDouble,
  muted = false,
  onPlaybackProgress,
  onPoster,
}) {
  const resolved = useMediaUri(uri, !!active);
  const playableUri = String(uri || "").startsWith("owp-media://") ? resolved.uri : uri;
  const source = useMemo(() => playableUri ? {uri:playableUri,useCaching:false} : null, [playableUri]);
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  });
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { currentTime = 0 } = useEvent(player, "timeUpdate", {
    currentTime: 0,
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: false });
  const [paused, setPaused] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const lastTap = useRef(0);
  const seekWidth = useRef(1);
  const singleTimer = useRef(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => {
      sub.remove();
      clearTimeout(singleTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);
  useEffect(() => {
    player.muted = muted;
    if (active && foreground && !paused) player.play();
    else player.pause();
  }, [active, foreground, paused, muted, player]);
  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      clearTimeout(singleTimer.current);
      lastTap.current = 0;
      onDouble?.();
    } else {
      lastTap.current = now;
      singleTimer.current = setTimeout(() => setPaused((v) => !v), 280);
    }
  };
  useEffect(()=>{const subscription=player.addListener('playToEnd',()=>onPlaybackProgress?.(1));return()=>subscription.remove();},[player,onPlaybackProgress]);
  const posterRequested = useRef(false);
  useEffect(()=>{posterRequested.current=false;},[uri]);
  useEffect(() => {
    if (!onPoster || status !== "readyToPlay" || posterRequested.current) return;
    posterRequested.current = true; let live = true;
    player.generateThumbnailsAsync([0], {maxWidth:720, maxHeight:1280})
      .then(images => { if (live && images[0]) onPoster(images[0]); }).catch(() => {});
    return () => { live = false; };
  }, [player, status, onPoster]);
  const duration = player.duration || 0;
  useEffect(() => { if (onPlaybackProgress && duration > 0) onPlaybackProgress(currentTime / duration); }, [currentTime, duration, onPlaybackProgress]);
  return (
    <View style={s.fill}>
      <VideoView
        style={s.fill}
        player={player}
        nativeControls={controls}
        contentFit={fit}
        surfaceType="textureView"
      />
      {!controls && (
        <Pressable
          accessibilityLabel="Lecture ou pause. Double appui pour aimer."
          onPress={tap}
          style={s.fill}
        />
      )}
      {!resolved.error && (resolved.loading || status === "loading" || status === "idle") && (
        <View pointerEvents="none" style={s.centerFill}>
          <ActivityIndicator color="white" size="large" />
        </View>
      )}
      {(resolved.error || status === "error") && (
        <View style={s.centerFill}>
          <Text style={s.white}>Vidéo indisponible</Text>
          <Text style={[s.smallWhite, { textAlign: "center", padding: 14 }]}>
            {resolved.error?.message || error?.message ||
              "Vérifie la connexion ou importe une vidéo depuis ton téléphone."}
          </Text>
          <Button
            title="Réessayer"
            onPress={async () => {
              try {
                if (!playableUri || resolved.error) { resolved.retry(); return; }
                await player.replaceAsync(source);
                if (active) player.play();
              } catch {
                Alert.alert("Vidéo", "Ce fichier ne peut pas être lu.");
              }
            }}
          />
        </View>
      )}
      {!controls && paused && !isPlaying && !resolved.error && status !== "error" && (
        <View pointerEvents="none" style={s.centerFill}>
          <Icon name="play" size={70} color="#ffffffb0" />
        </View>
      )}
      {!controls && (
        <View style={s.timelineWrap}>
          <Text style={s.timeLabel}>
            {clock(currentTime)} / {clock(duration)}
          </Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Avancer dans la vidéo"
            onPress={(e) => {
              if (duration)
                player.currentTime =
                  Math.max(
                    0,
                    Math.min(1, e.nativeEvent.locationX / seekWidth.current),
                  ) * duration;
            }}
            onLayout={(e) => {
              seekWidth.current = e.nativeEvent.layout.width || 1;
            }}
            style={s.seekHit}
          >
            <View style={s.timeline}>
              <View
                style={[
                  s.timelineFill,
                  {
                    width: `${Math.min(100, duration ? (currentTime / duration) * 100 : 0)}%`,
                  },
                ]}
              />
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Photos({ media, fit = "contain", onDouble }) {
  const scroll = useRef(null);
  const mediaKey = media.map(m => m.uri).join("|");
  const [width, setWidth] = useState(1);
  const [index, setIndex] = useState(0);
  const last = useRef(0);
  useEffect(() => { setIndex(0); scroll.current?.scrollTo({x:0,animated:false}); }, [mediaKey, width]);
  return (
    <View style={s.fill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scroll}
        directionalLockEnabled
        nestedScrollEnabled
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.max(0, Math.min(media.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))))
        }
      >
        {media.map((m, i) => (
          <Pressable
            key={`${m.uri}-${i}`}
            style={{ width, height: "100%" }}
            onPress={() => {
              const now = Date.now();
              if (now - last.current < 300) onDouble?.();
              last.current = now;
            }}
          >
            <Image source={{ uri: m.uri }} style={s.flex} resizeMode={fit} />
          </Pressable>
        ))}
      </ScrollView>
      {media.length > 1 && (
        <View pointerEvents="none" style={s.photoCounter}>
          <Text style={s.photoCounterText}>{index + 1}/{media.length}</Text>
        </View>
      )}
    </View>
  );
}

function PostCard({
  post,
  height,
  active,
  user,
  liked,
  following,
  commentCount,
  onLike,
  onFollow,
  onProfile,
  onReaction,
  onShare,
  onMore,
  onView,
}) {
  useEffect(()=>{if(active)onView?.();},[active,post.id]);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionHasMore, setCaptionHasMore] = useState(false);
  useEffect(() => {
    setCaptionExpanded(false);
    setCaptionHasMore(false);
  }, [post.id, post.caption]);
  const heart = useRef(new Animated.Value(0)).current;
  const m = post.media[0];
  const doubleLike = () => {
    onLike(true);
    heart.setValue(0);
    Animated.sequence([
      Animated.timing(heart, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(500),
      Animated.timing(heart, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  };
  return (
    <View style={{ height, backgroundColor: "#070707", overflow: "hidden" }}>
      {m.type === "video" ? (
        active ? (
          <Movie uri={m.uri} active onDouble={doubleLike} />
        ) : (
          <MediaThumb media={m} />
        )
      ) : (
        <Photos media={post.media} fit="contain" onDouble={doubleLike} />
      )}
      <Animated.View
        pointerEvents="none"
        style={[
          s.centerFill,
          {
            opacity: heart,
            transform: [
              {
                scale: heart.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1.3],
                }),
              },
            ],
          },
        ]}
      >
        <Icon name="heart" size={100} color={RED} />
      </Animated.View>
      <View style={s.rail}>
        <View style={{ marginBottom: 17 }}>
          <Avatar user={user} size={49} onPress={onProfile} />
          {user.id !== "me" && !following && (
            <Tap
              label={`Ajouter ${user.name || "ce compte"} aux contacts`}
              onPress={onFollow}
              style={s.followBadge}
            >
              <Icon name="add" size={17} color="#fff" />
            </Tap>
          )}
        </View>
        <Tap label="Choisir une réaction" onPress={onReaction} style={s.railButton}>
          <RNText style={{fontSize:33,color:"white"}}>{post.myReaction || "♡"}</RNText>
          {post.likes != null && <Text style={s.railText}>{compact(post.likes)}</Text>}
        </Tap>
        {onShare&&<RailButton icon="arrow-redo" text="Partager" onPress={onShare} label="Partager"/>}
        <Tap
          onPress={onMore}
          label="Options de la publication"
          style={s.record}
        >
          <Icon name="ellipsis-horizontal" size={21} color="white" />
        </Tap>
      </View>
      <View style={s.captionBlock}>
        {post.author !== "me" && (
          <Tap onPress={onProfile}>
            <Text style={[s.white, { fontWeight: "800", fontSize: 17 }]}>
              {user.name} {user.verified ? "✓" : ""}
            </Text>
          </Tap>
        )}
        {/* Comme TikTok : deux lignes au départ, description complète sur demande. */}
        <View style={{ marginTop: 7, marginBottom: 8 }}>
          {/* Mesure invisible du nombre réel de lignes, sans couper les mots. */}
          <Text
            onTextLayout={(event) => {
              const hasMore = event.nativeEvent.lines.length > 2;
              if (hasMore !== captionHasMore) setCaptionHasMore(hasMore);
            }}
            style={[s.caption, { position: "absolute", opacity: 0, marginTop: 0, marginBottom: 0, left: 0, right: 0 }]}
            pointerEvents="none"
          >
            {post.caption}
          </Text>
          {captionExpanded ? (
            <ScrollView
              style={{ maxHeight: Math.min(height * 0.34, 260) }}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              onStartShouldSetResponder={() => true}
            >
              <HashtagText style={[s.caption, { marginTop: 0, marginBottom: 3 }]}>{post.caption}</HashtagText>
            </ScrollView>
          ) : (
            <HashtagText style={[s.caption, { marginTop: 0, marginBottom: 2 }]} numberOfLines={2} ellipsizeMode="tail">
              {post.caption}
            </HashtagText>
          )}
          {captionHasMore && (
            <Tap onPress={() => setCaptionExpanded(v => !v)} label={captionExpanded ? "Réduire la description" : "Lire toute la description"} style={{ alignSelf: "flex-start", paddingVertical: 3, paddingRight: 15 }}>
              <Text style={{ color: "#e1e4e8", fontWeight: "800", fontSize: 13 }}>
                {captionExpanded ? "moins" : "plus"}
              </Text>
            </Tap>
          )}
        </View>
      </View>
    </View>
  );
}
function RailButton({ icon, color = "white", text, onPress, label }) {
  return (
    <Tap label={label} onPress={onPress} style={s.railButton}>
      <Icon name={icon} size={33} color={color} />
      <Text style={s.railText}>{text}</Text>
    </Tap>
  );
}

function Feed({ posts, renderCard, active = true, top, initialPostId, refreshing = false, onRefresh }) {
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const indexRef = useRef(0);
  const gestureStart = useRef(0);
  const gestureIndex = useRef(0);
  const settled = useRef(true);
  const dataKey = posts.map((p) => p.id).join("|");
  const initialIndex = initialPostId
    ? Math.max(0, posts.findIndex((p) => p.id === initialPostId))
    : 0;

  useEffect(() => {
    const next = initialPostId
      ? Math.max(0, posts.findIndex((p) => p.id === initialPostId))
      : Math.min(indexRef.current, Math.max(0, posts.length - 1));
    indexRef.current = next;
    setIndex(next);
    if (height > 0 && posts.length) {
      listRef.current?.scrollToOffset({ offset: next * height, animated: false });
    }
  }, [initialPostId, dataKey, height]);

  const finish = (offset) => {
    if (!height || !posts.length) return;
    const next = Math.max(0, Math.min(posts.length - 1, Math.round(offset / height)));
    indexRef.current = next;
    setIndex(next);
    settled.current = true;
    // Corrige les demi-écrans qui peuvent rester après un geste interrompu.
    listRef.current?.scrollToOffset({ offset: next * height, animated: false });
  };

  return (
    <View style={s.flex} onLayout={(e) => {
      const h = Math.round(e.nativeEvent.layout.height);
      if (h > 0 && h !== height) setHeight(h);
    }}>
      {height > 0 && (
        <FlatList
          ref={listRef}
          data={posts}
          keyExtractor={(p) => p.id}
          pagingEnabled
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          bounces={true}
          overScrollMode="always"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={RED} colors={[RED, CYAN]} progressBackgroundColor="#181818" /> : undefined}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          directionalLockEnabled
          onScrollBeginDrag={(e) => {
            gestureStart.current = e.nativeEvent.contentOffset.y;
            gestureIndex.current = indexRef.current;
            settled.current = false;
          }}
          onMomentumScrollEnd={(e) => finish(e.nativeEvent.contentOffset.y)}
          onScrollEndDrag={(e) => {
            // Sans inertie, React Native peut ne pas émettre onMomentumScrollEnd.
            const offset = e.nativeEvent.contentOffset.y;
            const velocity = e.nativeEvent.velocity?.y || 0;
            if (Math.abs(velocity) < 0.12) finish(offset);
          }}
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={5}
          removeClippedSubviews={false}
          renderItem={({ item, index: i }) => renderCard(item, height, active && index === i)}
          ListEmptyComponent={<Empty title="Aucune publication" body="Suis un créateur ou ajoute ta première publication." />}
        />
      )}
      {top}
    </View>
  );
}

// Remote grids load durable JPEG covers, never dozens of paused video decoders.
function VideoThumb({ uri }) {
  const resolved = useMediaUri(uri);
  uri = String(uri || "").startsWith("owp-media://") ? resolved.uri : uri;
  const player = useVideoPlayer(uri, p => { p.muted = true; });
  const {status} = useEvent(player, 'statusChange', {status:player.status});
  const [image,setImage]=useState(null);
  useEffect(()=>{let live=true;
    if(status==='readyToPlay')player.generateThumbnailsAsync([0],{maxWidth:360}).then(images=>{if(live)setImage(images[0]);}).catch(()=>{});
    return()=>{live=false;};
  },[player,status]);
  return image?<ExpoImage source={image} style={s.fill} contentFit="cover"/>:<VideoPlaceholder/>;
}
function VideoPlaceholder(){return <View style={[s.fill,s.center]}><Icon name="play-circle-outline" color="white" size={30}/><Text style={[s.smallWhite,{textAlign:'center'}]}>Aperçu indisponible</Text></View>;}
function MediaThumb({ media }) {
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const retryTimer=useRef(null);
  const uri=media?.thumbnailUri||media?.poster||(media?.type==='image'?media.uri:null);
  useEffect(()=>{setFailed(false);setAttempt(0);return()=>clearTimeout(retryTimer.current);},[uri]);
  const failedImage=()=>{setFailed(true);if(media?.thumbnailUri&&attempt<3)retryTimer.current=setTimeout(()=>{setAttempt(v=>v+1);setFailed(false);},3000*2**attempt);};
  if(!media)return <View style={s.fill}/>;
  if(uri&&!failed)return <Image key={attempt} source={{uri:attempt&&media.thumbnailUri&&!uri.startsWith("owp-media://")?uri+"?retry="+attempt:uri}} style={s.fill} resizeMode="cover" onError={failedImage}/>;
  if(media.type==='video'&&/^(?:file:|content:)/.test(media.uri))return <VideoThumb uri={media.uri}/>;
  return <VideoPlaceholder/>;
}

function Thumb({ post, onPress, width, completion = false }) {
  const m = post.media[0];
  return (
    <Tap
      onPress={onPress}
      label={post.caption || "Ouvrir la publication"}
      style={{
        width,
        height: width * 1.35,
        backgroundColor: "#272830",
        overflow: "hidden",
        borderWidth: 0,
      }}
    >
      <MediaThumb media={m} />
      {completion && <View pointerEvents="none" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5, backgroundColor: "rgba(0,0,0,0.40)", paddingTop: 15 }}>
        <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.4)" }}><View style={{ height: 4, width: "100%", backgroundColor: "#25F4EE" }} /></View>
      </View>}
      <View style={s.thumbTop}>
        <Icon
          name={m.type === "video" ? "play" : "images"}
          size={15}
          color="white"
        />
      </View>
      {post.views != null && <View style={s.thumbBottom}>
        <Icon name="play-outline" color="white" size={13} />
        <Text style={s.smallWhite}>{compact(post.views)}</Text>
      </View>}
    </Tap>
  );
}


// Cercle animé pendant l'enregistrement de la Story.
// Il s'arrête uniquement après la confirmation de l'opération locale.
function BearStoryUploadingRing({size=120}) {
  const rotation=useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    const animation=Animated.loop(Animated.timing(rotation,{toValue:1,duration:1050,useNativeDriver:true}));
    animation.start();
    return ()=>animation.stop();
  },[rotation]);
  const spin=rotation.interpolate({inputRange:[0,1],outputRange:["0deg","360deg"]});
  return <Animated.View pointerEvents="none" style={{position:"absolute",width:size,height:size,borderRadius:size/2,borderWidth:4,borderColor:"transparent",borderTopColor:CYAN,borderRightColor:CYAN,transform:[{rotate:spin}]}}/>;
}

// Stories Bear Like : sélection de la galerie, aperçu et publication distante.
function BearStoryPreview({ media, onBack, onPublish, theme = "navy", busy }) {
  const palette = PULSE_THEMES[theme] || PULSE_THEMES.navy;
  return <View style={{flex:1,backgroundColor:palette.bg,paddingHorizontal:12,paddingTop:12,paddingBottom:20}}>
    <View style={{flex:1,borderRadius:18,overflow:"hidden",backgroundColor:"#000"}}>
      {media.type === "video" ? <Movie uri={media.uri} active fit="contain" /> : <Image source={{uri:media.uri}} resizeMode="contain" style={{width:"100%",height:"100%"}}/>}
      <Tap onPress={onBack} label="Retour" style={{position:"absolute",top:14,left:14,padding:10,borderRadius:30,backgroundColor:"#0008"}}><Icon name="arrow-back" size={25} color="white"/></Tap>
    </View>
    <Tap disabled={busy} onPress={onPublish} style={{marginTop:12,borderRadius:30,backgroundColor:RED,minHeight:55,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:10}}>
      {busy ? <ActivityIndicator color="white"/> : <Icon name="add-circle" size={23} color="white"/>}
      <Text style={{color:"white",fontWeight:"800",fontSize:17}}>{busy ? "Publication…" : "Ta Story"}</Text>
    </Tap>
  </View>;
}

// Publications : ordre de sélection conservé jusqu'aux upload_key 0..19.
const BEAR_PUBLICATION_PHOTO_LIMIT = 1;
function bearValidatePublicationMedia(media) {
  if (!Array.isArray(media) || !media.length) throw Error("Sélectionne une photo ou une vidéo.");
  if (media.length !== 1) throw Error("Une publication OwpenGram contient une seule photo ou vidéo. Ton brouillon est conservé : retire les autres médias avant de publier.");
  if (!['image','video'].includes(media[0].type)) throw Error("Ce média ne peut pas être publié.");
}
function bearTogglePublicationMedia(current, item) {
  if (current.some(m => m.selectionKey === item.selectionKey))
    return current.filter(m => m.selectionKey !== item.selectionKey);
  const next = [...current, item];
  bearValidatePublicationMedia(next);
  return next;
}

// Ne pas confondre miniature et fichier lisible. Une copie réussie valide
// aussi les content:// Android ; l'échec EXIF/localisation n'interdit pas
// d'essayer l'URI de l'asset. Aucun téléchargement de miniature distante.
async function bearResolveGalleryMedia(item, normalizePublicationPhoto=false) {
  let info = null;
  if (item.galleryAsset) {
    try { info = await MediaLibrary.getAssetInfoAsync(item.galleryAsset); }
    catch (_) { /* Essayer le fichier sans dépendre des métadonnées EXIF. */ }
  }
  const candidates = [...new Set([info?.localUri, info?.uri, item.uri].filter(Boolean))];
  const directory = FS.cacheDirectory + 'bear-gallery/';
  await FS.makeDirectoryAsync(directory, {intermediates:true});
  const fileName = item.fileName || info?.filename || item.galleryAsset?.filename || '';
  for (const uri of candidates) {
    if (!/^(file|content):\/\//i.test(uri)) continue;
    const mimeExt = {'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'video/mp4':'mp4'}[item.mimeType];
    const ext = mimeExt || /\.(png|webp|jpe?g|mp4|mov|m4v|heic|heif)$/i.exec(uri.split('?')[0])?.[1]?.toLowerCase()
      || /\.(png|webp|jpe?g|mp4|mov|m4v|heic|heif)$/i.exec(fileName)?.[1]?.toLowerCase()
      || (item.type === 'video' ? 'mp4' : 'jpg');
    if (item.type === 'video' && ['mov', 'm4v', 'heic', 'heif'].includes(ext)) continue; // Vidéos inchangées.
    const destination = directory + uid() + '.' + ext;
    try {
      bearActiveGalleryFiles.add(destination);
      await FS.copyAsync({from:uri, to:destination});
      const stat = await FS.getInfoAsync(destination);
      if (!stat.exists || stat.isDirectory || stat.size === 0) throw Error('Unreadable media');
      const {galleryAsset, selectionKey, ...media} = item;
      if (normalizePublicationPhoto && item.type === 'image') {
        // La galerie intégrée fournit parfois un fichier brut non décodable par
        // OwpenGram. Reproduire le chemin natif : décoder puis réencoder localement.
        // Ne jamais réencoder les vidéos, ni modifier le chemin des Stories.
        const png = ext === 'png';
        const result = await ImageManipulator.manipulateAsync(destination, [], {
          compress: png ? 1 : 0.9,
          format: png ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
        });
        const checked = await FS.getInfoAsync(result.uri);
        if (!checked.exists || !(Number(checked.size) > 0)) throw Error('Photo réencodée illisible');
        // Vérifier les octets réels, comme pour les photos du sélecteur natif.
        const prepared = await preparePhotoFile({uri:result.uri}, FS, 'publication');
        const normalized = directory + uid() + '.' + (png ? 'png' : 'jpg');
        bearActiveGalleryFiles.add(normalized);
        try { await FS.copyAsync({from:prepared.uri,to:normalized}); }
        catch (error) { bearActiveGalleryFiles.delete(normalized); throw error; }
        await FS.deleteAsync(destination,{idempotent:true}).catch(()=>{});
        bearActiveGalleryFiles.delete(destination);
        return {...media, uri:normalized, fileName:'publication.'+(png?'png':'jpg'),
          mimeType:prepared.type, width:result.width || item.width, height:result.height || item.height};
      }
      return {...media, uri:destination, fileName, width:info?.width || item.width, height:info?.height || item.height};
    } catch (_) {
      await FS.deleteAsync(destination, {idempotent:true}).catch(() => {});
    }
  }
  throw Error("Ce fichier n’est plus accessible. Choisis-le avec la galerie du téléphone ou vérifie les autorisations.");
}

function BearStoryGallery({ onBack, onSelect, onDrafts, theme="navy", forPublication=false }) {
  const palette = PULSE_THEMES[theme] || PULSE_THEMES.navy;
  const [assets, setAssets] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [permissionError, setPermissionError] = useState(false);
  const [limited, setLimited] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const longPressHandled = useRef(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef([]), busyRef = useRef(false), live = useRef(true);
  const page = useRef({cursor:null, hasNext:false, loading:false, refresh:false});
  const setSelection = items => { selectedRef.current = items; setSelected(items); };
  // Une seule requête galerie à la fois ; un retour au premier plan pendant
  // une pagination programme un rechargement après cette requête.
  const load = useCallback(async (reset=true, ask=false) => {
    if (!live.current) return;
    if (page.current.loading) { if (reset) page.current.refresh = true; return; }
    if (!reset && !page.current.hasNext) return;
    page.current.loading = true;
    setLoading(true);
    try {
      const perm = ask
        ? await MediaLibrary.requestPermissionsAsync(false, ["photo", "video"])
        : await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
      if (!live.current) return;
      const allowed = perm.granted || perm.accessPrivileges === "limited";
      setLimited(perm.accessPrivileges === "limited");
      if (!allowed) {
        setPermissionError(true); setAssets([]); setHasNextPage(false);
        page.current.cursor = null; page.current.hasNext = false;
        return;
      }
      const result = await MediaLibrary.getAssetsAsync({
        first:60,
        ...(reset ? {} : {after:page.current.cursor}),
        sortBy:[[MediaLibrary.SortBy.creationTime, false]],
        mediaType:[MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      });
      if (!live.current) return;
      setAssets(old => {
        const merged = reset ? (result.assets || []) : [...old, ...(result.assets || [])];
        return [...new Map(merged.map(a => [a.id, a])).values()];
      });
      page.current.cursor = result.endCursor;
      page.current.hasNext = !!result.hasNextPage;
      setHasNextPage(!!result.hasNextPage); setPermissionError(false);
    } catch (_) {
      if (live.current) {
        setPermissionError(true); setHasNextPage(false); page.current.hasNext = false;
      }
    } finally {
      page.current.loading = false;
      if (live.current) {
        setLoading(false);
        if (page.current.refresh) { page.current.refresh = false; void load(true); }
      }
    }
  }, []);
  useEffect(() => {
    live.current = true; void load(true, true);
    const app = AppState.addEventListener("change", state => { if (state === "active") void load(true); });
    const gallery = MediaLibrary.addListener(() => { void load(true); });
    return () => { live.current = false; app.remove(); gallery.remove(); };
  }, [load]);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busyRef.current) onBack();
      return true;
    });
    return () => back.remove();
  }, [onBack]);
  const finish = async items => {
    if (busyRef.current || !items.length) return;
    busyRef.current = true; setBusy(true);
    const resolved = [];
    try {
      if (forPublication) bearValidatePublicationMedia(items);
      for (const item of items) resolved.push(await bearResolveGalleryMedia(item, forPublication && !!item.galleryAsset));
      if (!live.current) {
        await Promise.all(resolved.map(m => FS.deleteAsync(m.uri, {idempotent:true}).catch(() => {})));
        return;
      }
      onSelect(forPublication ? resolved : resolved[0]);
    } catch (error) {
      await Promise.all(resolved.map(m => FS.deleteAsync(m.uri, {idempotent:true}).catch(() => {})));
      if (live.current) Alert.alert("Média indisponible", error.message, [
        {text:"Annuler", style:"cancel"},
        {text:"Ouvrir la galerie du téléphone", onPress:() => chooseNative()},
      ]);
    } finally {
      busyRef.current = false;
      if (live.current) setBusy(false);
    }
  };
  const select = (asset, longPress=false) => {
    if (busyRef.current) return;
    if (!longPress && longPressHandled.current === asset.id) {
      longPressHandled.current = null; return;
    }
    if (!longPress) longPressHandled.current = null;
    const item = {selectionKey:asset.id, galleryAsset:asset, uri:asset.uri,
      type:asset.mediaType === "video" ? "video" : "image", duration:asset.duration || 0, durationSeconds:asset.duration || 0,
      fileName:asset.filename || '', width:asset.width, height:asset.height};
    if (!forPublication) { void finish([item]); return; }
    if (longPress) {
      if (item.type !== 'image') return; // Une seule vidéo par publication.
      longPressHandled.current = asset.id;
      setMultiSelect(true);
      setSelection(selectedRef.current[0]?.type === 'image'
        ? (selectedRef.current.some(m=>m.selectionKey===item.selectionKey)
          ? selectedRef.current : [...selectedRef.current,item].slice(0,BEAR_PUBLICATION_PHOTO_LIMIT))
        : [item]);
      return;
    }
    try {
      if (!multiSelect || item.type === 'video') {
        setMultiSelect(false); setSelection([item]);
      } else {
        const next = bearTogglePublicationMedia(selectedRef.current,item);
        setSelection(next);
        if (!next.length) setMultiSelect(false);
      }
    } catch (error) { Alert.alert("Choisir un format", error.message); }
  };
  const chooseNative = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let storyMedia = null;
    try {
      const items = forPublication ? await pickMedia(false, false, false, true) : await (async () => {
        const result = await ImagePicker.launchImageLibraryAsync({mediaTypes:["images","videos"], allowsMultipleSelection:false, quality:1});
        return result.canceled ? null : (result.assets || []).map(a => ({uri:a.uri,
          type:a.type === "video" ? "video" : "image", duration:a.duration || 0,durationSeconds:Number(a.duration||0)/1000,
          assetId:a.assetId, fileName:a.fileName || '', mimeType:a.mimeType || '', width:a.width, height:a.height}));
      })();
      if (!live.current) return;
      if (items?.length) {
        if (forPublication) { setSelection(items.map(a => ({...a, selectionKey:a.assetId || uid()}))); setMultiSelect(items.length > 1); }
        else storyMedia = items[0];
      }
    } catch (error) {
      if (live.current) Alert.alert("Galerie", error.message || "Impossible d’ouvrir la galerie.");
    } finally {
      busyRef.current = false;
      if (live.current) { setBusy(false); void load(true); }
    }
    if (storyMedia && live.current) await finish([storyMedia]);
  };
  const shown = assets.filter(a => filter === "all" || (filter === "photos" ? a.mediaType === "photo" : a.mediaType === "video"));
  const black = forPublication ? '#000000' : palette.bg;
  const white = forPublication ? '#FFFFFF' : palette.text;
  const chooseFilter = () => Alert.alert('Afficher les médias', 'Choisir un filtre', [
    {text:'Récent',onPress:()=>setFilter('all')},
    {text:'Photos',onPress:()=>setFilter('photos')},
    {text:'Vidéos',onPress:()=>setFilter('videos')},
    {text:'Annuler',style:'cancel'},
  ]);
  return <View style={{flex:1, backgroundColor:black}}>
    <View style={{height:64, flexDirection:"row", alignItems:"center", paddingHorizontal:18, justifyContent:"space-between"}}>
      <Tap disabled={busy} onPress={onBack} style={{padding:6,width:42}}><Icon name="close" size={29} color={white}/></Tap>
      <Text style={{fontSize:20,fontWeight:"800",color:white,textAlign:'center',flex:1}}>{forPublication ? "Nouvelle publication" : "Ajouter à la Story"}</Text>
      <Tap disabled={busy || loading} onPress={() => Alert.alert('Galerie', 'Options', [
        {text:'Actualiser',onPress:()=>load(true,true)},
        {text:'Autorisations',onPress:()=>Linking.openSettings()},
        {text:'Annuler',style:'cancel'},
      ])} label="Options de la galerie" style={{padding:6,width:42,alignItems:'flex-end'}}><Icon name={forPublication?'settings-outline':'refresh'} size={25} color={white}/></Tap>
    </View>
    {forPublication && <View style={{flexDirection:'row',paddingHorizontal:16,paddingTop:8,paddingBottom:4,gap:10}}>
      <Tap disabled={busy} onPress={onDrafts} style={{backgroundColor:'#222225',borderRadius:18,paddingHorizontal:18,paddingVertical:15,flexDirection:'row',alignItems:'center',gap:9}}>
        <Icon name="albums-outline" color="white" size={23}/><Text style={{color:'white',fontWeight:'700',fontSize:16}}>Brouillons</Text>
      </Tap>
      <Tap disabled={busy} onPress={chooseNative} style={{backgroundColor:'#222225',borderRadius:18,paddingHorizontal:14,paddingVertical:15,flexDirection:'row',alignItems:'center',gap:8,flexShrink:1}}>
        <Icon name="images-outline" color="white" size={23}/><Text style={{color:'white',fontWeight:'700',fontSize:14}}>Galerie du téléphone</Text>
      </Tap>
    </View>}
    {!forPublication && <Tap disabled={busy} onPress={chooseNative} style={{marginHorizontal:14,marginVertical:8,backgroundColor:palette.panel,borderRadius:15,minHeight:65,justifyContent:"center",alignItems:"center",gap:5}}>
      <Icon name="images-outline" size={26} color={palette.text}/><Text style={{color:palette.text,fontWeight:"700"}}>Ouvrir la galerie du téléphone</Text>
    </Tap>}
    {limited && <Text style={{color:palette.muted,marginHorizontal:16}}>Accès limité : seuls les médias autorisés sont affichés. Utilise la galerie du téléphone pour en choisir d’autres.</Text>}
    {forPublication ? <Tap disabled={busy} onPress={chooseFilter} style={{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:17,paddingTop:14,paddingBottom:13}}>
      <Text style={{color:'white',fontSize:18,fontWeight:'800'}}>{filter==='all'?'Récent':filter==='photos'?'Photos':'Vidéos'}</Text><Icon name="chevron-down" color="white" size={18}/>
    </Tap> : <View style={{flexDirection:"row",paddingHorizontal:16,paddingVertical:8,gap:25,borderBottomWidth:1,borderColor:palette.border}}>
      {[["all","Tous"],["photos","Photos"],["videos","Vidéos"]].map(([id,label]) => <Tap key={id} disabled={busy} onPress={() => setFilter(id)} style={{paddingVertical:8,borderBottomWidth:2,borderColor:filter === id ? CYAN : "transparent"}}><Text style={{color:filter === id ? palette.text : palette.muted,fontWeight:"800"}}>{label}</Text></Tap>)}
    </View>}
    {permissionError ? <View style={{flex:1,padding:22,gap:12}}>
      <Text style={{color:palette.text,textAlign:"center"}}>Autorise l’accès à tes photos pour afficher ta galerie ici.</Text>
      <Button title="Réglages" disabled={busy} onPress={() => Linking.openSettings()}/>
    </View> : <FlatList style={{flex:1}} key={filter} data={shown} numColumns={3} extraData={selected} keyExtractor={a => a.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={CYAN}/>}
      onEndReached={() => load(false)} onEndReachedThreshold={0.5}
      renderItem={({item}) => {
        const order = selected.findIndex(m => m.selectionKey === item.id);
        return <Tap disabled={busy} onPress={() => select(item)} onLongPress={forPublication && item.mediaType === "photo" ? () => select(item,true) : undefined} delayLongPress={450} label={bearTranslate(order >= 0 ? "Désélectionner" : "Sélectionner")} style={{width:"33.333%",aspectRatio:0.78,borderWidth:order >= 0 ? 3 : 1,borderColor:order >= 0 ? CYAN : black}}>
          <Image source={{uri:item.uri}} style={{width:"100%",height:"100%"}} resizeMode="cover"/>
          {forPublication && order >= 0 && <View style={{position:"absolute",top:7,right:7,width:27,height:27,borderRadius:14,borderWidth:2,borderColor:"white",backgroundColor:CYAN,alignItems:"center",justifyContent:"center"}}><Text style={{color:"#000",fontWeight:"800"}}>{order >= 0 ? order + 1 : ""}</Text></View>}
          {item.mediaType === "video" && <View style={{position:"absolute",bottom:7,right:7,flexDirection:"row",gap:3,alignItems:"center"}}><Icon name="play" size={14} color="white"/><Text style={{color:"white",fontSize:11}}>{Math.floor((item.duration || 0)/60)}:{String(Math.floor((item.duration || 0)%60)).padStart(2,"0")}</Text></View>}
        </Tap>;
      }}
      ListEmptyComponent={loading ? <ActivityIndicator style={{marginTop:30}} color={CYAN}/> : <Text style={{textAlign:"center",color:palette.muted,marginTop:30}}>Aucun média trouvé</Text>}
      ListFooterComponent={hasNextPage ? <Button title="Charger plus" disabled={loading || busy} onPress={() => load(false)}/> : null}/>
    }
    {forPublication && <View style={{padding:12,gap:8,borderTopWidth:1,borderColor:palette.border}}>
      {!!selected.length && <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {selected.map((m,i) => <Tap key={m.selectionKey} disabled={busy} onPress={() => setSelection(selectedRef.current.filter(a => a.selectionKey !== m.selectionKey))} label={bearTranslate("Désélectionner")} style={{width:54,height:62,marginRight:8}}>
          <Image source={{uri:m.uri}} style={{width:54,height:54,borderRadius:6}}/>
          <View style={{position:"absolute",top:0,right:0,backgroundColor:CYAN,borderRadius:8,paddingHorizontal:5}}><Text style={{color:"#000",fontWeight:"800"}}>{i+1} ×</Text></View>
        </Tap>)}
      </ScrollView>}
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
        <Text style={{color:palette.text,fontWeight:"700"}}>{selected.length}/{selected[0]?.type === "video" ? 1 : BEAR_PUBLICATION_PHOTO_LIMIT} <Text>{selected[0]?.type === "video" ? "Vidéo" : "Photos"}</Text></Text>
        <Button title="Suivant" disabled={busy || !selected.length} onPress={() => finish(selectedRef.current)}/>
      </View>
    </View>}
    {busy && <View style={[StyleSheet.absoluteFillObject,{backgroundColor:"#0009",alignItems:"center",justifyContent:"center"}]}><ActivityIndicator size="large" color={CYAN}/><Text style={{color:"white",marginTop:12}}>Préparation des médias…</Text></View>}
  </View>;
}

function BearStoryViewer({story,onClose,theme="navy"}) {
  const [progress,setProgress]=useState(0),[imageReady,setImageReady]=useState(false);
  useEffect(()=>{setProgress(0);setImageReady(false);},[story?.id]);
  useEffect(()=>{if(!imageReady||story.media.type==='video')return;const started=Date.now();const timer=setInterval(()=>setProgress(Math.min(1,(Date.now()-started)/6000)),90);return()=>clearInterval(timer);},[story?.id,imageReady]);
  useEffect(()=>{if(progress>=0.98)onClose();},[progress]);
  return <View style={{flex:1,backgroundColor:'#000'}}>
    {story.media.type==='video'?<Movie uri={story.media.uri} active fit="contain" onPlaybackProgress={setProgress}/>:<Image source={{uri:story.media.uri}} onLoad={()=>setImageReady(true)} onError={()=>Alert.alert('Story','Image indisponible. Réessaie plus tard.')} style={{flex:1}} resizeMode="contain"/>}
    <View style={{position:'absolute',top:16,left:12,right:12,height:3,backgroundColor:'#ffffff70'}}><View style={{height:3,width:`${progress*100}%`,backgroundColor:'white'}}/></View>
    <Tap onPress={onClose} style={{position:'absolute',top:30,right:16,padding:10,backgroundColor:'#0007',borderRadius:24}}><Icon name="close" color="white" size={27}/></Tap>
    <View style={{position:'absolute',top:36,left:16,flexDirection:'row',alignItems:'center',gap:10}}><Icon name="ellipse" color={CYAN} size={20}/><Text style={{color:'white',fontWeight:'800'}}>Story</Text></View>
  </View>;
}

const BEAR_AGE_RANGES = ["1 à 4", "5 à 8", "9 à 13", "14 à 17", "18 à 24", "25 à 34", "35 à 44", "45 à 54", "55 à 64", "65 à 74", "75 à 84", "85 à 100"];
function BearProfileExtras({ user, palette, compact = false }) {
  const url = String(user?.profileLink || "").trim();
  const age = String(user?.preferredAgeRange || "").trim();
  return <View style={{marginTop: compact ? 5 : 10, gap: compact ? 5 : 7}}>
    {!!age && <Text style={{color:palette.text,fontSize:14}}>Tranche d'âge préférée : {age} ans</Text>}
    {!!url && <Tap label="Ouvrir le lien du profil" onPress={() => {
      if (!/^https:\/\//i.test(url)) return;
      Linking.openURL(url).catch(() => Alert.alert("Lien", "Impossible d'ouvrir ce lien."));
    }}><Text style={{color:CYAN,fontSize:14}} numberOfLines={2}>{url}</Text></Tap>}
  </View>;
}

// Flamme statique sans notification ; animation seulement avec des notifications non lues.
function AnimatedProfileFlame({ animated = false }) {
  const flicker = useRef(new Animated.Value(0)).current;
  const ember = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const one = Animated.loop(Animated.sequence([
      Animated.timing(flicker,{toValue:1,duration:330,useNativeDriver:true}),
      Animated.timing(flicker,{toValue:0.25,duration:220,useNativeDriver:true}),
      Animated.timing(flicker,{toValue:0.85,duration:290,useNativeDriver:true}),
      Animated.timing(flicker,{toValue:0,duration:360,useNativeDriver:true}),
    ]));
    const two = Animated.loop(Animated.sequence([
      Animated.timing(ember,{toValue:1,duration:610,useNativeDriver:true}),
      Animated.timing(ember,{toValue:0,duration:580,useNativeDriver:true}),
    ]));
    if(animated){one.start();two.start();}
    return ()=>{one.stop();two.stop();flicker.setValue(0);ember.setValue(0);};
  },[flicker,ember,animated]);
  if(!animated)return <View accessibilityLabel="Aucune notification non lue" style={{width:32,height:36,alignItems:"center",justifyContent:"center"}}><RNText style={{fontSize:27,lineHeight:34}}>🔥</RNText></View>;
  return <View accessibilityLabel={animated?'Flamme animée, notifications non lues':'Flamme animée'} style={{width:32,height:36,alignItems:'center',justifyContent:'center'}}>
    <Animated.View style={{position:'absolute',opacity:ember.interpolate({inputRange:[0,1],outputRange:[0.15,0.65]}),transform:[{scale:ember.interpolate({inputRange:[0,1],outputRange:[0.7,1.18]})}]}}>
      <RNText style={{fontSize:27,lineHeight:34}}>🔥</RNText>
    </Animated.View>
    <Animated.View style={{transform:[{rotate:flicker.interpolate({inputRange:[0,1],outputRange:['-7deg','8deg']})},{scaleX:flicker.interpolate({inputRange:[0,1],outputRange:[0.94,1.08]})},{scaleY:flicker.interpolate({inputRange:[0,1],outputRange:[0.94,1.17]})},{translateY:flicker.interpolate({inputRange:[0,1],outputRange:[1,-2]})}]}}>
      <RNText style={{fontSize:27,lineHeight:34}}>🔥</RNText>
    </Animated.View>
    {animated && <View style={{position:'absolute',top:0,right:-2,width:9,height:9,borderRadius:5,backgroundColor:'#FE2C55',borderWidth:1,borderColor:'#fff'}} />}
  </View>;
}

function Profile({user,own,posts=[],drafts=[],onEdit,onSettings,onOpen,onDraft,onMessage,onCreate,onBack,onContact,isContact=false,contactBusy=false,refreshing=false,onRefresh,recentPublicationId,theme='navy'}) {
  const {width}=useWindowDimensions();
  const palette=PULSE_THEMES[theme]||PULSE_THEMES.navy;
  return <ScrollView style={{flex:1,backgroundColor:palette.bg}} contentContainerStyle={{paddingBottom:24,flexGrow:1}} refreshControl={onRefresh?<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[CYAN]} tintColor={CYAN}/>:undefined}>
    <View style={{height:50,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:18}}>
      <Tap onPress={own?onEdit:onBack} label={own?'Modifier le profil':'Retour'} style={{padding:5}}><Icon name={own?'pencil-outline':'arrow-back-outline'} size={27} color={palette.text}/></Tap>
      <Text style={{color:palette.text,fontWeight:'800'}}>Profil OwpenGram</Text>
      <Tap onPress={own?onSettings:onMessage} label={own?'Paramètres':'Envoyer un message'}><Icon name={own?'menu-outline':'chatbubble-outline'} size={29} color={palette.text}/></Tap>
    </View>
    <View style={{paddingHorizontal:17,paddingTop:3,paddingBottom:12}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
        <View style={{flex:1,paddingRight:8}}><Text numberOfLines={2} style={{color:palette.text,fontSize:24,fontWeight:'800'}}>{user.name||user.handle||'Compte OwpenGram'}</Text>
          {!!user.handle&&<Text style={{color:palette.muted,fontSize:12,marginTop:2}}>@{user.handle}</Text>}
          <Text style={{color:palette.muted,fontSize:12,marginTop:11}}>{posts.length} publication{posts.length===1?'':'s'} sur ce profil</Text>
        </View>
        <View style={{width:102,height:102,alignItems:'center',justifyContent:'center'}}><Avatar user={user} size={94}/></View>
      </View>
      {!!user.bio&&<HashtagText style={{color:palette.text,fontSize:13,marginTop:5}}>{user.bio}</HashtagText>}
      <View style={{flexDirection:'row',gap:10,marginTop:12}}>
        {own?<Button title="Ajouter une publication" onPress={onCreate} style={{flex:1}}/>:<><Button title="Message" onPress={onMessage} style={{flex:1}}/><Button title={contactBusy?'Enregistrement…':isContact?'Retirer des contacts':'Ajouter aux contacts'} secondary={isContact} disabled={contactBusy} onPress={onContact} style={{flex:1}}/></>}
      </View>
    </View>
    <View style={{height:43,borderBottomWidth:1,borderBottomColor:palette.border,alignItems:'center',justifyContent:'center'}}><Icon name="grid-outline" size={22} color={palette.text}/></View>
    <View style={s.grid}>
      {own&&drafts.length>0&&<Tap onPress={onDraft} label="Ouvrir les brouillons" style={[s.draftTile,{width:width/3,height:(width/3)*1.35,backgroundColor:palette.panel}]}><Icon name="documents-outline" size={28} color={palette.text}/><Text style={{color:palette.text,fontWeight:'700'}}>Brouillons</Text><Text style={{color:palette.text}}>{drafts.length}</Text></Tap>}
      {posts.map(p=><Thumb key={p.id} post={p} width={width/3} completion={recentPublicationId===p.id} onPress={()=>onOpen(p)}/>)}
    </View>
    {!posts.length&&<View style={{alignItems:'center',padding:38,gap:9}}><Icon name="images-outline" size={36} color={palette.muted}/><Text style={{color:palette.text,fontWeight:'700'}}>Aucune publication chargée</Text><Text style={{color:palette.muted,textAlign:'center'}}>Les publications conservées sur ce profil OwpenGram apparaissent ici.</Text></View>}
  </ScrollView>;
}
function PublicProfile(props) { return <Profile {...props} own={false}/>; }

function NativeContacts({users,contacts,query,onQuery,onProfile,onMessage,onContact,busy,loading,error,onRefresh,theme='navy'}) {
  const palette=PULSE_THEMES[theme]||PULSE_THEMES.navy;
  return <View style={{flex:1,backgroundColor:palette.bg}}><Header title="Contacts et recherche"/>
    <View style={{padding:15}}><TextInput accessibilityLabel="Rechercher un compte OwpenGram" value={query} onChangeText={onQuery} placeholder="Nom ou pseudo OwpenGram" autoCapitalize="none" autoCorrect={false} style={[s.field,{color:palette.text,backgroundColor:palette.soft}]}/></View>
    {!!error&&<Tap onPress={onRefresh} label="Réessayer la recherche" style={{padding:15}}><Text style={{color:'#ff9d9d'}}>{error} · Réessayer</Text></Tap>}
    {loading&&<ActivityIndicator color={CYAN}/>}
    <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={CYAN}/>}>
      {users.map(user=><View key={user.id} style={{padding:15,borderBottomWidth:1,borderBottomColor:palette.border}}>
        <Tap onPress={()=>onProfile(user.id)} style={{flexDirection:'row',gap:12,alignItems:'center'}}><Avatar user={user} size={52}/><View style={{flex:1}}><Text style={{color:palette.text,fontWeight:'800',fontSize:16}}>{user.name||user.handle}</Text>{!!user.handle&&<Text style={{color:palette.muted}}>@{user.handle}</Text>}</View></Tap>
        <View style={{flexDirection:'row',gap:8,marginTop:12}}><Button title="Message" secondary onPress={()=>onMessage(user.id)} style={{flex:1}}/><Button title={busy===user.id?'Enregistrement…':contacts.includes(user.id)?'Retirer des contacts':'Ajouter aux contacts'} secondary={contacts.includes(user.id)} disabled={!!busy} onPress={()=>onContact(user.id)} style={{flex:1}}/></View>
      </View>)}
      {!loading&&!users.length&&<Text style={{padding:30,textAlign:'center',color:palette.muted}}>{query.trim()?'Aucun compte trouvé.':'Tes contacts OwpenGram apparaîtront ici.'}</Text>}
    </ScrollView>
  </View>;
}

// Messagerie Bear Like : interface sombre inspirée de la vidéo de référence.
const CHAT_BG = "#0c192a";
const CHAT_PANEL = "#18293c";
const CHAT_BLUE = "#4276a9";
const CHAT_TEXT = "#f4f7fb";
const chatTime = (at) => new Date(at || Date.now()).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"});
function Inbox({ chats, onChat, meta = {}, onMeta, remoteUsers = [], onNewChat, refreshing = false, onRefresh, hasMore=false, theme = "navy" }) {
  const ui = PULSE_THEMES[theme] || PULSE_THEMES.navy;
  const [query, setQuery] = useState('');
  const [,tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(v=>v+1),1000);return()=>clearInterval(t);},[]);
  const liveChats=Object.fromEntries(Object.entries(chats).map(([id,rows])=>[id,rows.filter(m=>!m.expiresAt||m.expiresAt>Date.now())]));
  const [filter, setFilter] = useState("Tous");
  const [selectedChat, setSelectedChat] = useState(null);
  const latest = user => {
    const cached = (liveChats[user.id] || []).slice(-1)[0];
    if (user.lastMessageId != null || user.lastMessageAt || user.lastMessage) {
      const at = typeof user.lastMessageAt === 'number' ? user.lastMessageAt : Date.parse(user.lastMessageAt || '') || 0;
      return {id:user.lastMessageId,at:at || cached?.at || 0,text:user.lastMessage || '',type:cached && String(cached.id) === String(user.lastMessageId) ? cached.type : 'text'};
    }
    return cached;
  };
  const people = remoteUsers.filter(u => {
    const last = latest(u);
    const q = query.trim().toLowerCase();
    return (!q || `${u.name} ${u.handle} ${last?.text || ""}`.toLowerCase().includes(q)) &&
      (filter !== "Messages" || !!last) && (filter === "Archives" ? !!meta[u.id]?.archived : !meta[u.id]?.archived);
  }).sort((a,b) => Number(!!meta[b.id]?.pinned)-Number(!!meta[a.id]?.pinned) || (latest(b)?.at || 0) - (latest(a)?.at || 0));
  return <View style={{flex:1,backgroundColor:ui.bg}}>
    <View style={{paddingHorizontal:17,paddingTop:18,paddingBottom:12,backgroundColor:ui.panel}}>
      <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
        <Text style={{fontSize:25,fontWeight:"800",color:ui.text}}>Dialogues</Text>
        <View style={{flexDirection:"row",gap:19}}>
          <Icon name="search-outline" color="#cbd6e5" size={23}/>
          <Tap onPress={onNewChat} label="Nouvelle discussion"><Icon name="create-outline" color="#cbd6e5" size={24}/></Tap>
        </View>
      </View>
      <View style={{flexDirection:"row",alignItems:"center",backgroundColor:ui.soft,borderRadius:12,marginTop:15,paddingHorizontal:12}}>
        <Icon name="search" color="#8c9cad" size={19}/>
        <TextInput value={query} onChangeText={setQuery} placeholder="Rechercher une conversation" placeholderTextColor="#98a9bb" style={{color:ui.text,padding:10,flex:1}} />
        {!!query && <Tap onPress={()=>setQuery("")}><Icon name="close-circle" color="#98a9bb" size={20}/></Tap>}
      </View>
      <View style={{flexDirection:"row",gap:22,marginTop:17}}>
        {["Tous","Messages","Archives"].map(x=><Tap key={x} onPress={()=>setFilter(x)} style={{paddingBottom:10,borderBottomWidth:2,borderBottomColor:filter===x?"#5c9be3":"transparent"}}><Text style={{color:filter===x?"white":"#9aacc1",fontWeight:"700"}}>{x}</Text></Tap>)}
      </View>
    </View>
    <ScrollView style={{flex:1}} refreshControl={onRefresh?<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6fa9ee"/>:undefined} keyboardShouldPersistTaps="handled">
      {people.map(u=>{const last=latest(u); return <Tap key={u.id} onPress={()=>onChat(u.id)} onLongPress={()=>setSelectedChat(u)} style={{flexDirection:"row",alignItems:"center",paddingHorizontal:15,paddingVertical:13,gap:12,borderBottomColor:"#1c2a3b",borderBottomWidth:0.7}}>
        <Avatar user={u} size={53}/>
        <View style={{flex:1,minWidth:0}}><View style={{flexDirection:"row",justifyContent:"space-between"}}><Text numberOfLines={1} style={{color:ui.text,fontSize:16,fontWeight:"700",flex:1}}>{u.name}</Text><Text style={{color:ui.muted,fontSize:11}}>{last?.at?chatTime(last.at):""}</Text></View>
          <Text numberOfLines={1} style={{color:ui.muted,marginTop:5,fontSize:13}}>{last?(last.type==="audio"?"🎙 Message vocal":last.type==="image"?"📷 Photo":last.type==="video"?"🎬 Vidéo":last.text||"Pièce jointe"):"Appuyer pour commencer une discussion"}</Text>
        </View>
      </Tap>})}
      {!people.length && <Text style={{textAlign:"center",color:ui.muted,padding:35}}>Aucune conversation trouvée</Text>}
    </ScrollView>
    {hasMore&&<Text style={{color:ui.muted,fontSize:12,padding:12}}>Les 100 conversations les plus récentes sont affichées ici. Les autres restent disponibles dans OwpenGram.</Text>}
    <Text style={{textAlign:"center",fontSize:10,color:"#7f91a7",padding:7}}>Conversations OwpenGram · actualiser pour recevoir</Text>
    <Modal visible={!!selectedChat} transparent animationType="fade" onRequestClose={()=>setSelectedChat(null)}><View style={{flex:1,justifyContent:"flex-end",backgroundColor:"#0009"}}><Tap onPress={()=>setSelectedChat(null)} style={{flex:1}}/><View style={{backgroundColor:ui.panel,padding:18,borderTopLeftRadius:20,borderTopRightRadius:20}}><Text style={{color:ui.text,fontSize:18,fontWeight:"700",marginBottom:15}}>{selectedChat?.name}</Text>{[["pin-outline",meta[selectedChat?.id]?.pinned?"Désépingler":"Épingler","pinned"],["archive-outline",meta[selectedChat?.id]?.archived?"Désarchiver":"Archiver","archived"]].map(([ico,label,key])=><Tap key={key} onPress={()=>{onMeta?.(selectedChat.id,{[key]:!meta[selectedChat.id]?.[key]});setSelectedChat(null)}} style={{padding:15,flexDirection:"row",gap:14,alignItems:"center"}}><Icon name={ico} color="white" size={23}/><Text style={{color:ui.text,fontSize:16}}>{label}</Text></Tap>)}</View></View></Modal>
  </View>;
}
// Conversation inspirée de la référence vidéo : interface compacte bleu nuit,
// sélecteur d'emojis, volet pièces jointes, médias et lecture plein écran.
const CHAT_EMOJIS = ["😂","😍","❤️","🥰","😘","🤣","😭","🔥","👍","😊","🥹","😎","😅","😁","😢","😡","😮","🤩","😇","🙏","👏","💙","💕","💯","😜","🤔","😏","🤗","😴","😋","😱","😬","🙃","👀","💋","✨","🎉","👌","🤝","💪","👋","🫶","😻","😈","🤍","💚","💜","💔"];
const voiceTime = seconds => {const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
function ChatVoicePlayer({uri, user}) {
  const resolved=useMediaUri(uri);
  const audioUri=String(uri||"").startsWith("owp-media://")?resolved.uri:uri;
  const player=useAudioPlayer(audioUri||null);
  const status=useAudioPlayerStatus(player);
  const [error,setError]=useState('');
  const duration=Number(status.duration)||0, current=Number(status.currentTime)||0;
  return <View style={{padding:10,minWidth:220,maxWidth:270,flexDirection:'row',alignItems:'center',gap:8}}>
    {user&&<Avatar user={user} size={32}/>}
    <Tap label={status.playing?'Pause':'Lire le vocal'} onPress={async()=>{try{setError('');if(!audioUri){resolved.retry?.();throw Error(resolved.error?.message||'Le vocal est en cours de chargement. Réessaie dans un instant.');}await setAudioModeAsync({allowsRecording:false,playsInSilentMode:true});if(status.playing)player.pause();else{if(duration&&current>=duration-0.1)await player.seekTo(0);player.play();}}catch(e){setError(e.message||'Audio indisponible');}}}>
      <Icon name={status.playing?'pause':'play'} size={26} color="#d9eee6"/>
    </Tap>
    <View style={{flex:1}}>
      <Pressable accessibilityRole="adjustable" accessibilityLabel="Progression du vocal" onPress={e=>{if(duration)player.seekTo(Math.min(duration,Math.max(0,e.nativeEvent.locationX/130*duration))).catch(()=>setError('Lecture indisponible'));}} style={{width:130,height:24,justifyContent:'center'}}>
        <View style={{height:4,backgroundColor:'#ffffff38',borderRadius:2}}><View style={{height:4,width:`${duration?Math.min(100,current/duration*100):0}%`,backgroundColor:'#72d7b6',borderRadius:2}}/></View>
      </Pressable>
      <Text style={{color:'#cbdcd8',fontSize:11}}>{resolved.loading||status.isBuffering?'Chargement…':`${voiceTime(current)} / ${duration?voiceTime(duration):'—'}`}</Text>
      {!!error&&<Text style={{color:'#ffb7b7',fontSize:11}}>{error}</Text>}
    </View>
  </View>;
}
function Chat({ user, messages, onSend, onDelete, onReact, onBack, onClearConversation, onChatSettings, onLoadOlder, hasOlder=false, loadingOlder=false, sessionUserId, theme='navy' }) {
  const ui=PULSE_THEMES[theme]||PULSE_THEMES.navy;
  const recorder=useAudioRecorder({...RecordingPresets.HIGH_QUALITY,isMeteringEnabled:true});
  const recorderStatus=useAudioRecorderState(recorder,150);
  const [phase,setPhase]=useState('idle'),[locked,setLocked]=useState(false),[draft,setDraft]=useState(null),[error,setError]=useState(''),[preview,setPreview]=useState(null),[menu,setMenu]=useState(false),[ttl,setTtl]=useState(null),[settingsBusy,setSettingsBusy]=useState(false),[selected,setSelected]=useState(null);
  const [composing,setComposing]=useState(false),[textDraft,setTextDraft]=useState(''),[attachment,setAttachment]=useState(null),[composerBusy,setComposerBusy]=useState(null);
  const composerLock=useRef(false),textDraftRef=useRef(''),textAttempt=useRef(null),attachmentRef=useRef(null);
  const gesture=useRef({down:false,x:0,y:0,locked:false,cancel:false}),phaseRef=useRef('idle'),mounted=useRef(true),list=useRef(null),draftRef=useRef(null),operation=useRef(Promise.resolve()),startedAt=useRef(0),appState=useRef(AppState.currentState||'active');
  const key=`@bear-voice-draft-v1:${sessionUserId}:${user.id}`;
  const transition=next=>{phaseRef.current=next;if(mounted.current)setPhase(next);};
  const report=message=>{if(mounted.current)setError(message);};
  const keepDraft=async next=>{await AsyncStorage.setItem(key,JSON.stringify(next));draftRef.current=next;if(mounted.current)setDraft(next);};
  const restoreMode=()=>setAudioModeAsync({allowsRecording:false,playsInSilentMode:true}).catch(()=>{});
  const removeNative=async()=>{if(recorder.uri)await FS.deleteAsync(recorder.uri,{idempotent:true}).catch(()=>{});};
  const stop=async(cancel=false)=>{
    if(phaseRef.current!=='recording')return;transition('stopping');
    let copied=null;
    try{
      const status=recorder.getStatus();
      const duration=Math.max(0,Number(status.durationMillis)||Date.now()-startedAt.current);
      await recorder.stop();
      if(cancel){await removeNative();transition('idle');return;}
      const source=recorder.uri,info=source?await FS.getInfoAsync(source):null;
      if(duration<300||!info?.exists||!Number.isFinite(info.size)||info.size<64){await removeNative();throw Error('Vocal trop court ou vide. Maintiens le micro plus longtemps.');}
      const dir=FS.documentDirectory+'bear-voice/';await FS.makeDirectoryAsync(dir,{intermediates:true});
      copied=dir+uid()+'.m4a';await FS.copyAsync({from:source,to:copied});
      await keepDraft({uri:copied,type:'audio',mimeType:'audio/mp4',clientMessageId:uid(),duration});
      await removeNative();transition('preview');
    }catch(e){if(copied&&!draftRef.current)await FS.deleteAsync(copied,{idempotent:true}).catch(()=>{});report(e.message||'Impossible de terminer le vocal');transition(draftRef.current?'preview':'idle');}
    finally{await restoreMode();if(mounted.current)setLocked(false);gesture.current.locked=false;}
  };
  const stopRef=useRef(stop);stopRef.current=stop;
  useEffect(()=>{
    mounted.current=true;transition('restoring');let live=true;
    AsyncStorage.getItem(key).then(async raw=>{if(!raw||!live)return;const saved=JSON.parse(raw);const info=await FS.getInfoAsync(saved.uri);if(info.exists&&live){draftRef.current=saved;setDraft(saved);transition('preview');}else if(live)await AsyncStorage.removeItem(key);}).catch(()=>report('Brouillon vocal inaccessible.')).finally(()=>{if(live&&phaseRef.current==='restoring')transition('idle');});
    return()=>{live=false;mounted.current=false;gesture.current.down=false;gesture.current.cancel=true;if(phaseRef.current==='recording')stopRef.current(true);};
  },[key,recorder]);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{
    appState.current=state;
    // Permission dialogs may emit inactive; only actual background invalidates the gesture.
    if(state==='background'){gesture.current.down=false;gesture.current.cancel=true;if(phaseRef.current==='preparing')report('Enregistrement interrompu. Maintiens le micro pour recommencer.');stopRef.current(false);}
  });return()=>sub.remove();},[]);
  useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(composerLock.current||['preparing','sending','stopping'].includes(phaseRef.current))return true;if(phaseRef.current==='recording'){gesture.current.down=false;stopRef.current(false);return true;}onBack();return true;});return()=>sub.remove();},[]);
  useEffect(()=>{if(phase==='recording'&&recorderStatus.durationMillis>500&&!recorderStatus.isRecording&&!recorder.getStatus().isRecording){report('Capture interrompue. Vérifie la préécoute avant envoi.');stopRef.current(false);}},[phase,recorderStatus.isRecording,recorderStatus.durationMillis]);
  const begin=()=>{
    if(composerLock.current||phaseRef.current!=='idle')return;transition('preparing');setError('');gesture.current.cancel=false;gesture.current.locked=false;setLocked(false);
    operation.current=(async()=>{
      let prepared=false;
      try{
        let permission=await AudioModule.getRecordingPermissionsAsync();
        if(!permission.granted){
          permission=await AudioModule.requestRecordingPermissionsAsync();
          if(!permission.granted)throw Error('Autorise le microphone dans les paramètres du téléphone.');
          // The system dialog consumed the original touch. Never record on that stale gesture.
          gesture.current.down=false;throw Error('Microphone autorisé. Maintiens à nouveau le micro pour parler.');
        }
        if(!gesture.current.down||!mounted.current||appState.current==='background')throw Error('Maintiens le micro jusqu’au début de l’enregistrement.');
        await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true,shouldPlayInBackground:false,interruptionMode:'doNotMix'});
        await recorder.prepareToRecordAsync();prepared=true;
        if(!gesture.current.down||gesture.current.cancel||!mounted.current||appState.current==='background')throw Error('Enregistrement annulé avant le démarrage. Maintiens le micro pour recommencer.');
        recorder.record();startedAt.current=Date.now();transition('recording');
      }catch(e){if(prepared){await recorder.stop().catch(()=>{});await removeNative();}await restoreMode();transition('idle');report(e.message||'Enregistrement impossible');}
    })();
  };
  const discard=async()=>{const saved=draftRef.current;if(!saved)return;try{await AsyncStorage.removeItem(key);draftRef.current=null;setDraft(null);transition('idle');await FS.deleteAsync(saved.uri,{idempotent:true});}catch(e){report(e.message);}};
  const send=async()=>{if(composerLock.current||!draftRef.current||phaseRef.current==='sending')return;const saved=draftRef.current;transition('sending');setError('');try{await onSend(saved);await AsyncStorage.removeItem(key);draftRef.current=null;if(mounted.current)setDraft(null);transition('idle');await FS.deleteAsync(saved.uri,{idempotent:true}).catch(()=>{});}catch(e){transition('preview');report(e.message||'Échec de l’envoi. Le vocal est conservé : réessaie.');}};
  const canCompose=()=>!composerLock.current&&['idle','preview'].includes(phaseRef.current);
  const changeText=value=>{
    if(composerLock.current)return;
    textDraftRef.current=value;setTextDraft(value);
    if(textAttempt.current?.text!==value.trim())textAttempt.current=null;
  };
  const sendText=async()=>{
    const text=textDraftRef.current.trim();
    if(!text||!canCompose())return;
    const message=textAttempt.current?.text===text?textAttempt.current:{type:'text',text,clientMessageId:uid()};
    textAttempt.current=message;composerLock.current=true;setComposerBusy('text');setError('');
    try{
      await onSend(message);
      textDraftRef.current='';textAttempt.current=null;
      if(mounted.current)setTextDraft('');
    }catch(e){report(e?.message||'Message non envoyé. Ton texte est conservé : réessaie.');}
    finally{composerLock.current=false;if(mounted.current)setComposerBusy(null);}
  };
  const chooseAttachment=async()=>{
    if(!canCompose())return;
    composerLock.current=true;setComposerBusy('picking');setError('');
    try{
      const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images','videos'],allowsMultipleSelection:false,selectionLimit:1,quality:await getBearImageQuality(),videoMaxDuration:180,exif:false});
      if(result.canceled||!mounted.current)return;
      if(result.assets?.length!==1)throw Error('Choisis une seule photo ou vidéo pour ce message.');
      const asset=result.assets[0];
      if(!asset.uri||!['image','video'].includes(asset.type))throw Error('Cette photo ou vidéo est inaccessible. Sélectionne-la à nouveau.');
      const message={uri:asset.uri,type:asset.type,mimeType:asset.mimeType||'',fileName:asset.fileName||'',duration:asset.duration||0,width:asset.width,height:asset.height,clientMessageId:uid()};
      attachmentRef.current=message;setAttachment(message);
    }catch(e){report(e?.message||'Impossible d’ouvrir la galerie. Réessaie.');}
    finally{composerLock.current=false;if(mounted.current)setComposerBusy(null);}
  };
  const removeAttachment=()=>{if(!canCompose())return;attachmentRef.current=null;setAttachment(null);};
  const sendAttachment=async()=>{
    const message=attachmentRef.current;
    if(!message||!canCompose())return;
    composerLock.current=true;setComposerBusy('media');setError('');
    try{
      await onSend(message);
      attachmentRef.current=null;if(mounted.current)setAttachment(null);
    }catch(e){report(e?.message||'Média non envoyé. Ta sélection est conservée : réessaie.');}
    finally{composerLock.current=false;if(mounted.current)setComposerBusy(null);}
  };
  const composerDisabled=!!composerBusy||!['idle','preview'].includes(phase);
  const openMenu=async()=>{setMenu(true);setSettingsBusy(true);setError('');try{const r=await onChatSettings();setTtl(r.ttlSeconds);}catch(e){setTtl(null);setError(e.message||'Serveur à mettre à jour.');}finally{setSettingsBusy(false);}};
  const visible=messages.filter(m=>!m.expiresAt||m.expiresAt>Date.now());
  const firstVisible=useRef(visible[0]?.id);
  const [clock,setClock]=useState(0);useEffect(()=>{const t=setInterval(()=>setClock(v=>v+1),1000);return()=>clearInterval(t);},[]);
  return <View style={{flex:1,backgroundColor:ui.bg}}>
    <View style={{minHeight:56,backgroundColor:ui.panel,paddingHorizontal:10,flexDirection:'row',alignItems:'center',gap:10}}>
      <Tap label="Retour" onPress={()=>{if(composerLock.current||['preparing','sending','stopping'].includes(phaseRef.current))return;if(phaseRef.current==='recording'){gesture.current.down=false;stop(false);return;}onBack();}}><Icon name="arrow-back" color={ui.text}/></Tap>
      <Avatar user={user} size={36}/><View style={{flex:1}}><Text numberOfLines={1} style={{color:ui.text,fontSize:16,fontWeight:'700'}}>{user.name}</Text><Text style={{color:ui.muted,fontSize:11}}>Messages</Text></View>
      <Tap label="Options de la discussion" onPress={openMenu}><Icon name="ellipsis-vertical" color={ui.text}/></Tap>
    </View>
    <View style={{flex:1}}>
      <View pointerEvents="none" style={{position:'absolute',top:0,left:0,right:0,bottom:0,opacity:0.065,flexDirection:'row',flexWrap:'wrap',overflow:'hidden'}}>{Array.from({length:90},(_,i)=><View key={i} style={{width:'16.66%',height:70,alignItems:'center',justifyContent:'center',transform:[{rotate:`${i%5*15}deg`}]}}><Icon name={['planet-outline','heart-outline','musical-note-outline','star-outline'][i%4]} color="#cbdcd8" size={26}/></View>)}</View>
      <FlatList ref={list} style={{flex:1}} data={visible} extraData={clock} keyExtractor={m=>String(m.id)} onContentSizeChange={()=>{const first=visible[0]?.id,prepended=firstVisible.current&&first!==firstVisible.current;firstVisible.current=first;if(!prepended)list.current?.scrollToEnd({animated:false});}} maintainVisibleContentPosition={{minIndexForVisible:0}} contentContainerStyle={{padding:10,flexGrow:1,justifyContent:'flex-end'}}
        ListHeaderComponent={hasOlder?<Tap label="Charger les messages précédents" disabled={loadingOlder} onPress={onLoadOlder} style={{padding:16,alignItems:"center"}}>{loadingOlder?<ActivityIndicator color={CYAN}/>:<Text style={{color:ui.muted}}>Charger les messages précédents</Text>}</Tap>:null}
        ListEmptyComponent={<Text style={{color:ui.muted,textAlign:'center',padding:24}}>Écris un message, joins une photo ou vidéo, ou maintiens le micro pour parler.</Text>}
        renderItem={({item,index})=><View>
          {(index===0||new Date(item.at).toDateString()!==new Date(visible[index-1].at).toDateString())&&<Text style={{alignSelf:'center',color:'#cbdcd8',backgroundColor:'#202c33',paddingHorizontal:10,paddingVertical:4,borderRadius:8,marginVertical:9,fontSize:11}}>{new Date(item.at).toLocaleDateString('fr-FR')}</Text>}
          <Tap onLongPress={()=>setSelected(item)} style={{alignSelf:item.mine?'flex-end':'flex-start',maxWidth:'86%',backgroundColor:item.mine?'#005c4b':'#202c33',borderRadius:10,borderTopRightRadius:item.mine?2:10,borderTopLeftRadius:item.mine?10:2,marginVertical:3,overflow:'hidden'}}>
            {!!item.reply&&<View style={{margin:7,padding:7,borderLeftWidth:3,borderLeftColor:'#72d7b6',backgroundColor:'#ffffff12'}}><Text numberOfLines={2} style={{color:'#d9eee6',fontSize:12}}>↪ {item.reply.text}</Text></View>}{!!item.forwardedFrom&&<Text style={{color:'#a9beb9',fontSize:11,padding:6}}>↪ Transféré de {item.forwardedFrom}</Text>}
            {!!item.uri&&item.type==='audio'&&<ChatVoicePlayer uri={item.uri} user={item.mine?null:user}/>}
            {!!item.uri&&item.type!=='audio'&&<Tap label="Ouvrir le média" onPress={()=>setPreview(item)} style={{width:220,height:240}}><MediaThumb media={item}/>{item.type==='video'&&<View style={{position:'absolute',top:90,left:90}}><Icon name="play-circle" size={40} color="white"/></View>}</Tap>}
            {!!item.text&&<Text selectable style={{color:'#e9edef',fontSize:15,lineHeight:21,padding:9}}>{item.text}</Text>}
            {item.type!=='text'&&!item.uri&&<Text style={{color:'#cbdcd8',padding:10}}>Média indisponible · actualiser</Text>}
            <View style={{flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:4,paddingHorizontal:8,paddingBottom:5}}>{!!item.reaction&&<Text>{item.reaction}</Text>}<Text style={{color:'#a9beb9',fontSize:10}}>{chatTime(item.at)}{item.editedAt?' · modifié':''}</Text>{item.mine&&item.remote&&<Icon name={item.readAt?'checkmark-done':'checkmark'} size={14} color={item.readAt?'#53bdeb':'#a9beb9'}/>}</View>
          </Tap>
        </View>}/>
    </View>
    {!!error&&<Text style={{color:'#ffb7b7',paddingHorizontal:14,paddingVertical:8}}>{error}</Text>}
    <View style={{padding:10,minHeight:72,backgroundColor:ui.panel}}>
      {!!attachment&&<View style={{flexDirection:'row',alignItems:'center',gap:10,paddingBottom:10}}>
        <Tap disabled={composerDisabled} label="Prévisualiser le média sélectionné" onPress={()=>setPreview(attachment)} style={{width:64,height:76,borderRadius:8,overflow:'hidden'}}><MediaThumb media={attachment}/></Tap>
        <View style={{flex:1}}><Text style={{color:ui.text,fontSize:13,fontWeight:'700'}}>{attachment.type==='video'?'Vidéo prête à envoyer':'Photo prête à envoyer'}</Text><Text numberOfLines={1} style={{color:ui.muted,fontSize:11,marginTop:3}}>{attachment.fileName||'Un média sélectionné'}</Text></View>
        <Tap disabled={composerDisabled} label="Retirer le média sélectionné" onPress={removeAttachment}><Icon name="close-circle-outline" color={ui.muted}/></Tap>
        <Tap disabled={composerDisabled} label="Envoyer le média" onPress={sendAttachment} style={{padding:10}}>{composerBusy==='media'?<ActivityIndicator color="#72d7b6"/>:<Icon name="send" color="#72d7b6"/>}</Tap>
      </View>}
      <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:12}}>
        <Tap disabled={composerDisabled} label="Ajouter une photo ou vidéo" onPress={chooseAttachment} style={{paddingVertical:10}}>{composerBusy==='picking'?<ActivityIndicator color="#72d7b6"/>:<Icon name="image-outline" color="#72d7b6" size={26}/>}</Tap>
        {composing?<TextInput accessibilityLabel="Écrire un message" autoFocus value={textDraft} onChangeText={changeText} editable={!composerDisabled} multiline placeholder="Écrire un message…" placeholderTextColor={ui.muted} onBlur={()=>{if(!textDraftRef.current)setComposing(false);}} style={{flex:1,minHeight:42,maxHeight:110,borderRadius:18,paddingHorizontal:13,paddingVertical:10,backgroundColor:ui.bg,color:ui.text,fontSize:15}}/>:<Tap disabled={composerDisabled} label="Écrire un message" onPress={()=>{if(canCompose())setComposing(true);}} style={{flex:1,minHeight:42,borderRadius:18,paddingHorizontal:13,paddingVertical:12,backgroundColor:ui.bg}}><Text style={{color:ui.muted,fontSize:15}}>Écrire un message…</Text></Tap>}
        <Tap disabled={composerDisabled||!textDraft.trim()} label="Envoyer le texte" onPress={sendText} style={{paddingVertical:10,opacity:composerDisabled||!textDraft.trim()?0.45:1}}>{composerBusy==='text'?<ActivityIndicator color="#72d7b6"/>:<Icon name="send" color="#72d7b6"/>}</Tap>
      </View>
      {draft?<View><ChatVoicePlayer uri={draft.uri}/><View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Tap disabled={phase==='sending'||!!composerBusy} label="Supprimer le brouillon vocal" onPress={()=>Alert.alert('Supprimer ce vocal ?','Le vocal non envoyé sera supprimé de ce téléphone.',[{text:'Annuler',style:'cancel'},{text:'Supprimer',style:'destructive',onPress:discard}])}><Icon name="trash-outline" color="#ff9d9d"/></Tap><Text style={{color:ui.muted,fontSize:12}}>Préécoute · vocal conservé</Text><Tap disabled={phase==='sending'||!!composerBusy} label="Envoyer le vocal" onPress={send}>{phase==='sending'?<ActivityIndicator color="#72d7b6"/>:<Icon name="send" color="#72d7b6"/>}</Tap></View></View>:
      <View style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{flex:1}}><Text style={{color:ui.text,fontSize:14}}>{phase==='recording'?`● ${voiceTime(recorderStatus.durationMillis/1000)} ${locked?'· verrouillé':''}`:phase==='preparing'?'Préparation du microphone…':phase==='stopping'?'Préparation de la préécoute…':'Maintiens pour parler'}</Text><Text style={{color:ui.muted,fontSize:11,marginTop:4}}>{phase==='recording'?'← Annuler · ↑ Verrouiller':'Relâche pour préécouter'}</Text></View>
        {<>{locked&&<><Tap key="cancel-recording" label="Annuler l’enregistrement" onPress={()=>stop(true)}><Icon name="trash-outline" color="#ff9d9d"/></Tap><Tap label="Arrêter et préécouter" onPress={()=>stop(false)}><Icon name="stop-circle" size={46} color="#00a884"/></Tap></>}
        <View key="voice-microphone" accessible accessibilityLabel="Maintenir pour enregistrer, glisser à gauche pour annuler, vers le haut pour verrouiller" collapsable={false} onStartShouldSetResponder={()=>!composerLock.current&&['idle','preparing','recording'].includes(phaseRef.current)} onMoveShouldSetResponder={()=>['preparing','recording'].includes(phaseRef.current)} onResponderGrant={e=>{gesture.current={down:true,x:e.nativeEvent.pageX,y:e.nativeEvent.pageY,locked:false,cancel:false};begin();}} onResponderMove={e=>{if(!['preparing','recording'].includes(phaseRef.current))return;const g=gesture.current;if(g.locked)return;if(e.nativeEvent.pageX-g.x < -75){g.cancel=true;g.down=false;stop(true);}else if(phaseRef.current==='recording'&&e.nativeEvent.pageY-g.y < -65){g.locked=true;setLocked(true);}}} onResponderRelease={()=>{gesture.current.down=false;if(!gesture.current.locked)stop(gesture.current.cancel);}} onResponderTerminationRequest={()=>false} onResponderTerminate={()=>{gesture.current.down=false;if(!gesture.current.locked){gesture.current.cancel=true;report('Geste interrompu. Maintiens le micro pour recommencer.');stop(true);}}} style={{width:52,height:52,borderRadius:26,backgroundColor:'#00a884',alignItems:'center',justifyContent:'center',opacity:composerBusy?0.45:1}}><Icon name={locked?'lock-closed':phase==='recording'?'mic':'mic-outline'} color="#08291e" size={27}/></View></>}
      </View>}
    </View>
    <Modal visible={menu} transparent animationType="fade" onRequestClose={()=>setMenu(false)}><View style={{flex:1,backgroundColor:'#0009',justifyContent:'flex-end'}}><Tap style={{flex:1}} onPress={()=>setMenu(false)}/><View style={{backgroundColor:ui.panel,padding:20}}><Text style={{color:ui.text,fontSize:18,fontWeight:'700',marginBottom:14}}>Options de la discussion</Text>
      <Tap onPress={()=>Alert.alert('Supprimer la discussion pour toi ?','Ton historique sera masqué pour ton compte. Le correspondant conserve ses messages. Un nouveau vocal rouvrira la discussion.',[{text:'Annuler',style:'cancel'},{text:'Supprimer pour moi',style:'destructive',onPress:async()=>{try{await onClearConversation();setMenu(false);onBack();}catch(e){setError(e.message);}}}])} style={{paddingVertical:14}}><Text style={{color:'#ff9d9d'}}>Supprimer la discussion pour moi</Text></Tap>
      {!!error&&<Text style={{color:'#ffb7b7',marginBottom:10}}>{error}</Text>}<Text style={{color:ui.text,fontWeight:'700',marginVertical:12}}>Messages éphémères</Text>{settingsBusy?<ActivityIndicator color="#72d7b6"/>:[[0,'Désactivé'],[86400,'24 heures'],[604800,'7 jours'],[2592000,'30 jours']].map(([n,label])=><Tap key={n} disabled={ttl===null} onPress={async()=>{setSettingsBusy(true);try{const r=await onChatSettings(n);setTtl(r.ttlSeconds);}catch(e){setError(e.message);}finally{setSettingsBusy(false);}}} style={{flexDirection:'row',justifyContent:'space-between',paddingVertical:12}}><Text style={{color:ui.text}}>{label}</Text>{ttl===n&&<Icon name="checkmark" color="#72d7b6"/>}</Tap>)}
      <Text style={{color:ui.muted,fontSize:12,lineHeight:18,marginTop:12}}>Le choix vaut pour les deux participants et les prochains messages. Les anciens messages gardent leur délai. Les copies déjà enregistrées ailleurs ne sont pas effacées.</Text><Tap onPress={()=>setMenu(false)} style={{paddingVertical:16}}><Text style={{color:'#72d7b6'}}>Fermer</Text></Tap>
    </View></View></Modal>
    <Modal visible={!!selected} transparent onRequestClose={()=>setSelected(null)}><View style={{flex:1,backgroundColor:'#0009',justifyContent:'flex-end'}}><Tap style={{flex:1}} onPress={()=>setSelected(null)}/><View style={{backgroundColor:ui.panel,padding:20}}><View style={{flexDirection:'row',justifyContent:'space-around',padding:12}}>{['❤️','👍','😂','🔥','😮','😢'].map(e=><Tap key={e} onPress={()=>{onReact?.(selected.id,e);setSelected(null);}}><Text style={{fontSize:26}}>{e}</Text></Tap>)}</View>{selected?.mine&&<Tap onPress={()=>Alert.alert('Supprimer ce message ?','Cette suppression concerne les deux participants.',[{text:'Annuler',style:'cancel'},{text:'Supprimer',style:'destructive',onPress:()=>{onDelete?.(selected.id);setSelected(null);}}])} style={{padding:15}}><Text style={{color:'#ff9d9d'}}>Supprimer ce message</Text></Tap>}</View></View></Modal>
    <Modal visible={!!preview} animationType="fade" onRequestClose={()=>setPreview(null)}><View style={{flex:1,backgroundColor:'#000'}}>{preview?.type==='video'?<Movie uri={preview.uri} active controls fit="contain"/>:preview&&<Image source={{uri:preview.uri}} style={{flex:1}} resizeMode="contain"/>}<Tap label="Fermer le média" onPress={()=>setPreview(null)} style={{padding:20,alignItems:'center'}}><Icon name="close" color="white"/></Tap></View></Modal>
  </View>;
}

async function getBearImageQuality() {
  try {
    const raw = await AsyncStorage.getItem("@pulse-settings-v1");
    const prefs = raw ? JSON.parse(raw) : {};
    const mode = prefs["Qualité des médias"] || "Automatique";
    if (mode === "Économique") return 0.35;
    if (mode === "Standard") return 0.7;
    if (mode === "Haute qualité") return 1;
    return prefs["Économiseur de données"] ? 0.35 : 0.85;
  } catch { return 0.85; }
}

async function pickMedia(camera = false, video = false, avatar = false, publication = false) {
  if (camera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Autorisation nécessaire",
        "Autorise la caméra dans les réglages du téléphone.",
        [
          { text: "Annuler" },
          { text: "Réglages", onPress: () => Linking.openSettings() },
        ],
      );
      return null;
    }
  }
  const options = {
    mediaTypes: avatar
      ? ["images"]
      : camera
        ? video
          ? ["videos"]
          : ["images"]
        : ["images", "videos"],
    allowsEditing: avatar,
    // Réglage utilisateur appliqué aux images lors de leur sélection.
    // La compression vidéo nécessitera un traitement serveur dédié.
    quality: await getBearImageQuality(),
    exif: false,
    allowsMultipleSelection: !camera && !avatar && !publication,
    // Une publication native contient un seul média.
    selectionLimit: publication ? BEAR_PUBLICATION_PHOTO_LIMIT : 10,
    orderedSelection: publication,
    videoMaxDuration: 180,
  };
  const result = camera
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const assets = result.assets || [];
  if (publication && assets.length > BEAR_PUBLICATION_PHOTO_LIMIT) {
    Alert.alert("Choisir un format", "Sélectionne une seule photo ou vidéo.");
    return null;
  }
  if (assets.some((a) => a.type === "video") && assets.length > 1) {
    Alert.alert(
      "Choisir un format",
      publication ? "Sélectionne une seule photo ou vidéo." : "Sélectionne une seule vidéo ou plusieurs photos (10 maximum).",
    );
    return null;
  }
  return assets.map((a) => ({
    uri: a.uri,
    assetId: a.assetId,
    type: a.type === "video" ? "video" : "image",
    duration: a.duration || 0,
    durationSeconds: Number(a.duration || 0) / 1000,
    fileName: a.fileName || "",
    mimeType: a.mimeType || "",
    // Dimensions d'origine rapportées par Android ; aucune mise à l'échelle
    // n'est appliquée au fichier avant son ajout au fil local.
    width: a.width,
    height: a.height,
  }));
}

// Les photos restent sur leur URI retournée par Android, sans passage
// par une bibliothèque de compression/redimensionnement dans Bear Like.
// Le sélecteur Android peut toutefois fournir une copie transformée.
// Mode aperçu Snack : aucune copie persistante ni envoi serveur.
// Les fichiers choisis peuvent devenir indisponibles après redémarrage.
async function durableMedia(media, onStep) {
  const directory=FS.documentDirectory+'pulse-media/';
  await FS.makeDirectoryAsync(directory,{intermediates:true});
  const created=[],saved=[];
  try {for(let i=0;i<media.length;i++){
    const item=media[i];let uri=item.uri;
    if(!/^https?:/.test(uri)&&!uri.startsWith(directory)){
      const ext=item.type==='video'?'mp4':(item.mimeType==='image/png'?'png':item.mimeType==='image/webp'?'webp':(/\.(png|webp)$/i.exec(item.fileName||uri.split('?')[0])?.[1]?.toLowerCase()||'jpg'));
      const destination=directory+uid()+'.'+ext;
      await FS.copyAsync({from:uri,to:destination});uri=destination;created.push(uri);
    }
    saved.push({...item,uri});onStep?.(i+1,media.length);
  }}catch(error){await Promise.all(created.map(uri=>FS.deleteAsync(uri,{idempotent:true})));throw error;}
  return {media:saved,created};
}

function Publisher({ draft, initialMedia, onCommit, onClose, onDiscardPending, isPending = false, theme = "navy" }) {
  const publicationId=useRef(draft?.id||uid());
  const attempted=useRef(isPending);
  const ui = PULSE_THEMES[theme] || PULSE_THEMES.navy;
  const [media, setMedia] = useState(draft?.media || initialMedia || []);
  const [stage, setStage] = useState(draft || initialMedia?.length ? "preview" : "pick");
  const [uploadPoster, setUploadPoster] = useState(null);
  const rememberUploadPoster = useCallback(poster => setUploadPoster(poster), []);
  useEffect(() => { setUploadPoster(null); }, [media[0]?.uri]);
  const [caption, setCaption] = useState(draft?.caption || "");
  const visibility = "public";
  const [fit, setFit] = useState("contain");
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAsDraft, setSavedAsDraft] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const lock = useRef(false);
  const pickerOpened = useRef(false);
  const choose = async (camera, video) => {
    if (lock.current) return;
    lock.current = true;
    try {
      const selected = await pickMedia(camera, video, false, true);
      if (selected?.length) {
        if(attempted.current){await onDiscardPending(publicationId.current);publicationId.current=uid();attempted.current=false;}
        setMedia(selected);
        setStage("preview");
      }
    } catch (e) {
      Alert.alert(
        "Import impossible",
        e.message || "Réessaie avec un autre fichier.",
      );
    } finally { lock.current = false; }
  };
  useEffect(() => {
    if (stage !== "pick" || pickerOpened.current) return;
    pickerOpened.current = true;
    let mounted = true;
    (async () => {
      try {
        const selected = await pickMedia(false, false, false, true);
        if (!mounted) return;
        if (selected?.length) {
          setMedia(selected);
          setStage("preview");
        } else {
          close();
        }
      } catch (e) {
        if (!mounted) return;
        Alert.alert("Galerie", e.message || "Impossible d'ouvrir les médias.");
        close();
      }
    })();
    return () => { mounted = false; };
  }, [stage]);
  const removeMedia = async index => {
    if (lock.current || media.length <= 1) return;
    lock.current = true;
    try {
      if (attempted.current) {
        await onDiscardPending(publicationId.current);
        publicationId.current = uid(); attempted.current = false;
      }
      setMedia(old => old.filter((_, i) => i !== index));
    } catch (error) { Alert.alert("Erreur", error.message); }
    finally { lock.current = false; }
  };
  const save = async (isDraft) => {
    if (lock.current || !media.length) return;
    if (!isDraft) {
      try { bearValidatePublicationMedia(media); }
      catch (error) { Alert.alert("Choisir un format", error.message); return; }
    }
    lock.current = true;
    setBusy(true);
    setProgress({
      done: 0,
      total: 1,
      label: "Envoi et enregistrement sur le serveur…",
    });
    let result;
    try {
      result = isDraft
        ? await durableMedia(media, (done, total) =>
            setProgress({done,total:total+1,label:`Brouillon : média ${done}/${total} préparé`}))
        : {media,created:[]};
      setProgress((p) => ({
        ...p,
        label: isDraft ? "Enregistrement du brouillon…" : "Envoi vers OwpenGram…",
      }));
      if(!isDraft)attempted.current=true;
      await onCommit(
        {
          id: publicationId.current,
          media: result.media,
          caption: caption.trim(),
          visibility,
          allowComments: false,
          muted,
          createdAt: Date.now(),
        },
        isDraft,
        (fraction, label) => setProgress({done:Math.max(0,Math.min(1,fraction)),total:1,label:label || 'Envoi en cours…'}),
      );
      setProgress((p) => ({
        ...p,
        done: p.total,
        label: "Enregistrement terminé",
      }));
      setSavedAsDraft(isDraft);
      if (isDraft) setStage("done");
      // Pour une publication, App ferme directement cet écran et affiche le profil.

    } catch (e) {
      if (result)
        await Promise.all(
          result.created.map((uri) =>
            FS.deleteAsync(uri, { idempotent: true }).catch(() => {}),
          ),
        );
      const errorText=String(e?.message || "Vérifie l’espace disponible puis réessaie.");
      if(!isDraft && typeof onDiscardPending==='function'){
        Alert.alert("Enregistrement impossible",errorText,[
          {text:"Reprendre plus tard",style:"cancel"},
          {text:"Abandonner cet envoi",style:"destructive",onPress:()=>{
            onDiscardPending(publicationId.current).then(()=>onClose()).catch(error=>Alert.alert("Annulation impossible",String(error?.message||error)));
          }}
        ]);
      }else Alert.alert("Enregistrement impossible",errorText);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    if (stage === "done") {
      onClose();
      return;
    }
    if (media.length)
      Alert.alert(
        "Quitter la publication ?",
        "Tu peux conserver tes modifications dans un brouillon.",
        [
          { text: "Continuer", style: "cancel" },
          { text: "Abandonner", style: "destructive", onPress: onClose },
          { text: "Brouillon", onPress: () => save(true) },
        ],
      );
    else onClose();
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  });
  if (stage === "done")
    return (
      <View style={[s.whitePage, s.center]}>
        <Icon name="checkmark-circle" size={75} color={CYAN} />
        <Text style={s.emptyTitle}>
          {savedAsDraft ? "Brouillon enregistré" : "Publication enregistrée"}
        </Text>
        <Text style={[s.bold, { marginVertical: 15 }]}>100 %</Text>
        <Button title="Voir mon profil" onPress={onClose} />
      </View>
    );
  if (busy) {
    const selected = media[0];
    const imageSource = selected?.type === "image" ? {uri:selected.uri} :
      (uploadPoster || (selected?.thumbnailUri || selected?.poster ? {uri:selected.thumbnailUri || selected.poster} : null));
    const percentage = Math.round(progress.total ? progress.done / progress.total * 100 : 0);
    return <View style={{flex:1,backgroundColor:ui.bg,justifyContent:"center",alignItems:"center"}}>
      {!!imageSource && <ExpoImage source={imageSource} style={StyleSheet.absoluteFillObject} contentFit="cover" />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFillObject,{backgroundColor:"#0007"}]} />
      <View style={{width:"78%",padding:20,borderRadius:16,backgroundColor:"#000000cc",alignItems:"center"}}>
        <View accessibilityRole="progressbar" accessibilityValue={{min:0,max:100,now:percentage}}
          style={{width:"100%",height:7,borderRadius:5,backgroundColor:"#ffffff40",overflow:"hidden"}}>
          <View style={{width:`${percentage}%`,height:7,backgroundColor:CYAN}} />
        </View>
        <Text style={{color:"white",fontWeight:"800",fontSize:23,marginTop:14}}>{percentage} %</Text><Text style={{color:"white",fontSize:12,marginTop:10,textAlign:"center"}}>{progress.label}</Text>
      </View>
    </View>;
  }
  return (
    <View style={[s.whitePage, stage === "pick" && { backgroundColor: ui.bg }]}>
      {stage !== "pick" && <Header
        title={
          stage === "pick"
            ? "Créer"
            : stage === "preview"
              ? "Aperçu"
              : "Nouvelle publication"
        }
        onBack={() => (stage === "details" ? setStage("preview") : close())}
        right={
          <Tap style={s.iconButton} onPress={close} label="Fermer">
            <Icon name="close" />
          </Tap>
        }
      />}
      {stage === "pick" ? (
        <View style={[s.flex, s.center, { backgroundColor: ui.bg }]}>
          <ActivityIndicator size="large" color={RED} />
          <Text style={[s.white, { marginTop: 16 }]}>Ouverture de ta galerie…</Text>
        </View>
      ) : stage === "preview" ? (
        <>
          <View style={[s.flex, { backgroundColor: "#000" }]}>
            {media[0]?.type === "video" ? (
              <Movie
                key={media[0].uri}
                uri={media[0].uri}
                onPoster={rememberUploadPoster}
                active
                fit={fit}
                muted={muted}
                controls
              />
            ) : (
              <Photos key={media.map(m => m.uri).join("|")} media={media} fit={fit} />
            )}
            <View style={s.previewTools}>
              <Tap
                onPress={() =>
                  setFit((f) => (f === "contain" ? "cover" : "contain"))
                }
                style={s.toolPill}
              >
                <Icon name="expand" color="white" size={19} />
                <Text style={s.white}>
                  {fit === "contain" ? "Remplir l’aperçu" : "Voir en entier"}
                </Text>
              </Tap>
              <Tap onPress={() => choose(false)} style={s.toolPill}>
                <Icon name="images-outline" color="white" size={19} />
                <Text style={s.white}>Remplacer</Text>
              </Tap>
              {media[0]?.type === "video" && (
                <Tap onPress={() => setMuted((v) => !v)} style={s.toolPill}>
                  <Icon
                    name={muted ? "volume-mute" : "volume-high"}
                    color="white"
                    size={19}
                  />
                  <Text style={s.white}>Son de l’aperçu</Text>
                </Tap>
              )}
            </View>
          </View>
          {media.length > 1 && <BearFormScroll horizontal style={{maxHeight:76,backgroundColor:ui.panel}} contentContainerStyle={{padding:8}} showsHorizontalScrollIndicator={false}>
            {media.map((m,i) => <Tap key={`${m.uri}-${i}`} onPress={() => removeMedia(i)} label={bearTranslate("Retirer cette photo")} style={{width:58,height:58,marginRight:8}}>
              <Image source={{uri:m.uri}} style={{width:58,height:58,borderRadius:6}}/>
              <View style={{position:"absolute",top:0,right:0,backgroundColor:CYAN,borderRadius:8,paddingHorizontal:5}}><Text style={{color:"#000",fontWeight:"800"}}>{i+1} ×</Text></View>
            </Tap>)}
          </BearFormScroll>}
          <View style={s.bottomActions}>
            <Text style={[s.muted, { flex: 1 }]}>
              {media.length} média{media.length > 1 ? "s" : ""} · aperçu sans
              découpe du fichier
            </Text>
            <Button title="Suivant" onPress={() => setStage("details")} />
          </View>
        </>
      ) : (
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <BearFormScroll
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 18 }}
          >
            <View style={[s.row, { alignItems: "flex-start", gap: 14 }]}>
              <TextInput
                style={s.captionInput}
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={1024}
                placeholder="Décris ta publication… #hashtags"
                placeholderTextColor="#999"
              />
              <Tap onPress={() => setStage("preview")} style={s.previewThumb}>
                <MediaThumb media={media[0]} />
                <Text style={s.smallWhite}>Aperçu</Text>
              </Tap>
            </View>
            <Text style={[s.muted, { textAlign: "right" }]}>
              {caption.length}/1024
            </Text>
            <View style={s.categoryRow}>
              {["#pourtoi", "#voyage", "#nature"].map((t) => (
                <Tap
                  key={t}
                  style={s.chip}
                  onPress={() =>
                    setCaption((c) => `${c} ${t}`.trim().slice(0, 1024))
                  }
                >
                  <Text>{t}</Text>
                </Tap>
              ))}
            </View>
            <View style={s.settingRow}><Icon name="globe-outline"/><Text style={s.settingText}>Publication publique</Text></View>
            <Text style={[s.muted,{lineHeight:21,marginTop:12}]}>Une photo ou une vidéo de 18 Mio maximum, conservée dans les publications de ton profil OwpenGram.</Text>
          </BearFormScroll>
          <View style={s.bottomActions}>
            <Button
              secondary
              title="Brouillons"
              textColor="#FFFFFF"
              onPress={() => save(true)}
              style={[s.flex, { backgroundColor: ui.soft, borderColor: "#506583" }]}
            />
            <Button
              title="Publier"
              onPress={() => save(false)}
              style={s.flex}
            />
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function EditProfile({profile,onSave,onBack}) {
  const [form,setForm]=useState({...profile});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false);
  const chooseAvatar=async()=>{if(lock.current)return;try{const selected=await pickMedia(false,false,true);if(selected?.[0])setForm(old=>({...old,avatar:selected[0].uri,avatarType:'image',avatarMime:selected[0].mimeType,avatarFile:selected[0]}));}catch(e){setError(e.message);}};
  const save=async()=>{if(lock.current)return;if(!String(form.name||'').trim()){setError('Indique un nom.');return;}lock.current=true;setBusy(true);setError('');try{await onSave({...form,name:form.name.trim(),bio:String(form.bio||'').trim()});}catch(e){setError(e.message||'Enregistrement non confirmé. Tes modifications sont conservées.');}finally{lock.current=false;setBusy(false);}};
  return <View style={s.whitePage}><Header title="Modifier le profil" onBack={busy?undefined:onBack}/><BearFormScroll contentContainerStyle={{padding:20}}>
    <Tap onPress={chooseAvatar} disabled={busy} label="Changer la photo du profil" style={{alignItems:'center',marginBottom:24}}><Avatar user={form} size={94}/><Text style={{color:CYAN,marginTop:12}}>Changer la photo</Text></Tap>
    {!!profile.handle&&<Text style={[s.muted,{marginBottom:20}]}>@{profile.handle}</Text>}
    <Text style={[s.bold,{marginBottom:8}]}>Nom</Text><TextInput accessibilityLabel="Nom du profil" value={form.name||''} onChangeText={name=>setForm(old=>({...old,name}))} editable={!busy} maxLength={64} style={[s.field,{marginBottom:20}]}/>
    <Text style={[s.bold,{marginBottom:8}]}>Bio</Text><TextInput accessibilityLabel="Bio du profil" value={form.bio||''} onChangeText={bio=>setForm(old=>({...old,bio}))} editable={!busy} multiline maxLength={140} style={[s.field,{minHeight:110,marginBottom:20}]}/>
    {!!error&&<Text style={{color:'#ff9d9d',marginBottom:16}}>{error}</Text>}
    <Button title={busy?'Enregistrement sur OwpenGram…':'Enregistrer'} disabled={busy} onPress={save}/>
  </BearFormScroll></View>;
}

const bearActiveGalleryFiles=new Set();
const bearCacheAge=24*60*60*1000;
const bearBytes=n=>`${(Number(n||0)/1048576).toFixed(2)} Mo`;
async function bearLocalInventory() {
  if(!FS.cacheDirectory||!FS.documentDirectory)throw Error('Stockage local indisponible sur cette plateforme.');
  const entries=await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  const references=entries.map(([,value])=>value||'');
  const files=[],errors=[];
  for(const [base,label,cleanable] of [[FS.cacheDirectory+'bear-gallery/','Copies de galerie',true],[FS.documentDirectory+'pulse-media/','Brouillons et médias conservés',false],[FS.documentDirectory+'bear-voice/','Brouillons vocaux',false]]){
    try{const root=await FS.getInfoAsync(base);if(!root.exists)continue;
      for(const name of await FS.readDirectoryAsync(base)){
        if(name.includes('/')||name.includes('..'))continue;
        const uri=base+name,info=await FS.getInfoAsync(uri);
        if(!info.exists||info.isDirectory)continue; // Never recursively remove a directory.
        const referenced=bearActiveGalleryFiles.has(uri)||references.some(raw=>raw.includes(uri));
        const stale=Number(info.modificationTime)>0&&Date.now()-info.modificationTime*1000>bearCacheAge;
        files.push({uri,label,size:Number(info.size)||0,cleanable:cleanable&&stale&&!referenced});
      }
    }catch(e){errors.push(`${label} : ${e.message}`);}
  }
  return {files,errors,total:files.reduce((n,f)=>n+f.size,0),reclaimable:files.filter(f=>f.cleanable).reduce((n,f)=>n+f.size,0)};
}
async function bearCleanLocalFiles() {
  let released=0;const failures=[];
  const fresh=await bearLocalInventory();
      for(const file of fresh.files.filter(f=>f.cleanable)){
        try{const references=await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
          if(bearActiveGalleryFiles.has(file.uri)||references.some(([,raw])=>(raw||'').includes(file.uri)))continue;
          const before=await FS.getInfoAsync(file.uri);if(!before.exists||before.isDirectory||!before.modificationTime||Date.now()-before.modificationTime*1000<=bearCacheAge)continue;
          await FS.deleteAsync(file.uri,{idempotent:true});if(!(await FS.getInfoAsync(file.uri)).exists)released+=Number(before.size)||0;
        }catch(e){failures.push(e.message);}
      }
  return {released,failures,inventory:await bearLocalInventory()};
}
function BearLocalStorage({palette,onDrafts}) {
  const [inventory,setInventory]=useState(null),[busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState('');
  const refresh=async()=>{setBusy(true);setError('');try{setInventory(await bearLocalInventory());}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{refresh();},[]);
  const clean=async()=>{setBusy(true);setError('');try{const result=await bearCleanLocalFiles();setInventory(result.inventory);setResult(`${bearBytes(result.released)} effectivement libérés.`);setError(result.failures.join('\n'));}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <View style={{backgroundColor:palette.panel,borderRadius:12,padding:16}}><Text style={{color:palette.text,fontSize:19,fontWeight:'800'}}>Stockage local</Text>
    <Text style={{color:palette.text,marginTop:18}}>Fichiers identifiés : {inventory?bearBytes(inventory.total):'—'}</Text><Text style={{color:palette.text,marginTop:10}}>Nettoyables : {inventory?bearBytes(inventory.reclaimable):'—'}</Text>
    {inventory&&['Copies de galerie','Brouillons et médias conservés','Brouillons vocaux'].map(label=><Text key={label} style={{color:palette.muted,marginTop:10}}>{label} : {bearBytes(inventory.files.filter(f=>f.label===label).reduce((n,f)=>n+f.size,0))}</Text>)}
    <Text style={{color:palette.muted,lineHeight:20,marginVertical:16}}>Seules les copies de galerie inutilisées depuis plus de 24 heures sont nettoyées. Les brouillons, vocaux non envoyés, sessions, transferts et téléchargements conservés sont protégés. Le cache système et le cache vidéo ne sont pas inclus dans cette mesure.</Text>
    {!!result&&<Text style={{color:CYAN,marginBottom:10}}>{result}</Text>}{!!error&&<Text style={{color:RED,marginBottom:10}}>{error}</Text>}{inventory?.errors.map(e=><Text key={e} style={{color:RED}}>{e}</Text>)}
    {busy?<ActivityIndicator color={CYAN}/>:<><Button title="Actualiser" secondary onPress={refresh}/><Button title="Nettoyer les copies temporaires" disabled={!inventory?.reclaimable} style={{marginTop:12}} onPress={()=>Alert.alert('Nettoyer les copies temporaires ?',`${bearBytes(inventory.reclaimable)} identifiés. Les fichiers seront vérifiés à nouveau avant suppression.`,[{text:'Annuler',style:'cancel'},{text:'Nettoyer',onPress:clean}])}/><Tap onPress={onDrafts} style={{paddingVertical:18}}><Text style={{color:CYAN}}>Gérer les brouillons séparément</Text></Tap></>}
  </View>;
}

function PulseSettings({onBack,onDrafts,onProfile,onLogout,theme='navy',onThemeChange,language='fr',onLanguageChange}) {
  const palette=PULSE_THEMES[theme]||PULSE_THEMES.navy;
  const [storageOpen,setStorageOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const logout=async()=>{if(busy)return;setBusy(true);setError('');try{await onLogout();}catch(e){setError(e.message||'Déconnexion non confirmée. Réessaie.');}finally{setBusy(false);}};
  return <View style={{flex:1,backgroundColor:palette.bg}}><Header title="Paramètres" onBack={onBack}/><ScrollView contentContainerStyle={{padding:18}}>
    <Button title="Modifier mon profil OwpenGram" secondary onPress={onProfile}/>
    <Text style={{color:palette.text,fontSize:18,fontWeight:'800',marginTop:26,marginBottom:12}}>Apparence</Text>
    <View style={{flexDirection:'row',gap:8}}>{[['navy','Bleu nuit'],['dark','Noir'],['white','Clair']].map(([value,label])=><Button key={value} title={label} secondary={theme!==value} onPress={()=>onThemeChange?.(value)} style={{flex:1}}/>)}</View>
    <Text style={{color:palette.text,fontSize:18,fontWeight:'800',marginTop:26,marginBottom:12}}>Langue</Text>
    <View style={{flexDirection:'row',gap:8}}>{[['fr','Français'],['en','English'],['es','Español']].map(([value,label])=><Button key={value} title={label} secondary={language!==value} onPress={()=>onLanguageChange?.(value)} style={{flex:1}}/>)}</View>
    <Tap onPress={onDrafts} style={{paddingVertical:24}}><Text style={{color:palette.text,fontSize:16}}>Brouillons sur ce téléphone</Text></Tap>
    <Tap onPress={()=>setStorageOpen(v=>!v)} style={{paddingVertical:12}}><Text style={{color:palette.text,fontSize:16}}>Stockage local</Text></Tap>
    {storageOpen&&<BearLocalStorage palette={palette} onDrafts={onDrafts}/>}
    {!!error&&<Text style={{color:'#ff9d9d',marginTop:20}}>{error}</Text>}
    <Button title={busy?'Déconnexion…':'Se déconnecter d’OwpenGram'} disabled={busy} style={{marginTop:30}} onPress={()=>Alert.alert('Se déconnecter ?','Cette session OwpenGram sera fermée sur ce téléphone.',[{text:'Annuler',style:'cancel'},{text:'Se déconnecter',onPress:logout}])}/>
  </ScrollView></View>;
}

function languageLocale(){return bearLanguage==="en"?"en-US":bearLanguage==="es"?"es-ES":"fr-FR";}

function bearConversationRecipient(id,user) {
  const recipientId=String(id||''),recipient={recipientId};
  if (/^(?:owp|user):[1-9]\d{0,19}$/.test(recipientId)) {
    const username=String(user?.handle||user?.username||'').trim().replace(/^@/,'');
    if (/^[a-z][a-z0-9_]{2,31}$/i.test(username)&&!/^owp_\d+$/i.test(username)) recipient.recipientUsername=username;
  }
  return recipient;
}
function bearNormalizeMessage(message,selfId) {
  const mime=String(message.mime_type||message.mimeType||'');
  const type=message.type==='text'?'text':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':message.type==='video'?'video':message.type==='audio'?'audio':'image';
  const date=message.created_at??message.at;
  const at=typeof date==='number'?date:Date.parse(date)||Date.now();
  return {id:String(message.id),type,text:message.content||message.text||'',at,mine:String(message.sender_id)===String(selfId),remote:true,uri:message.uri||message.mediaUri||message.media?.uri,thumbnailUri:message.thumbnailUri||message.media?.thumbnailUri,readAt:message.read_at,replyTo:message.reply_to,editedAt:message.edited_at,reactions:message.reactions||{},reactionCounts:message.reactionCounts||[],durationSeconds:message.durationSeconds,reaction:Array.isArray(message.reactionCounts)&&message.reactionCounts.length?message.reactionCounts.map(item=>item.emoji+' '+item.count).join(' · '):Object.values(message.reactions||{}).join(' '),expiresAt:message.expires_at?Date.parse(message.expires_at):null};
}
function Main({session,language='fr',onLanguageChange,onLogout}) {
  const insets=useSafeAreaInsets();
  const [theme,chooseTheme]=useBearPreference('@pulse-appearance-v1','navy',BEAR_THEMES);
  applyPulseTheme(theme);
  const ui=PULSE_THEMES[theme]||PULSE_THEMES.navy;
  const namespace=accountNamespace(session.user.id),KEY=namespace+':state-direct-v1',postCacheKey=namespace+':posts-direct-v1',pendingKey=namespace+':pending-direct-v1';
  const nativeUser={...session.user,handle:session.user.username||session.user.handle||'',name:session.user.name||session.user.firstName||session.user.username||'Compte OwpenGram',bio:session.user.bio||''};
  const [data,setData]=useState({profile:nativeUser,drafts:[],chats:{},chatMeta:{}}),dataRef=useRef(data),writes=useRef(Promise.resolve());
  const [ready,setReady]=useState(false),[tab,setTab]=useState('feed'),[route,setRoute]=useState(null),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false);
  const [posts,setPosts]=useState([]),postsRef=useRef([]),[postState,setPostState]=useState('loading'),postLock=useRef(null);
  const [feedIds,setFeedIds]=useState([]),feedIdsRef=useRef([]),[feedCoverage,setFeedCoverage]=useState(null),coverageRef=useRef(null),postRevision=useRef(0);
  const [dialogHasMore,setDialogHasMore]=useState(false),[historyState,setHistoryState]=useState({}),historyRef=useRef({}),olderLock=useRef(false),[loadingOlder,setLoadingOlder]=useState(false);
  const [contacts,setContacts]=useState([]),[remoteUsers,setRemoteUsers]=useState([]),[query,setQuery]=useState(''),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState(''),searchSequence=useRef(0);
  const [profileCache,setProfileCache]=useState({}),[dialogs,setDialogs]=useState([]),[contactBusy,setContactBusy]=useState(null),contactLock=useRef(false);
  const [pending,setPending]=useState(null),pendingRef=useRef(null),publicationLock=useRef(false),[recentPublicationId,setRecentPublicationId]=useState(null);
  const [reactionPost,setReactionPost]=useState(null),[reactionBusy,setReactionBusy]=useState(false),reactionLock=useRef(false),[reactionError,setReactionError]=useState('');
  const [optionsPost,setOptionsPost]=useState(null),[editingPost,setEditingPost]=useState(null),[editCaption,setEditCaption]=useState(''),[editBusy,setEditBusy]=useState(false),editLock=useRef(false);
  const remoteChatIds=useRef({}),activeChatRef=useRef(null),conversationLock=useRef(null),conversationEpoch=useRef(0),mounted=useRef(true);
  const request=owpenApi.request;
  const notice=e=>{if(mounted.current)setError(String(e?.message||e||'Opération non confirmée. Réessaie.'));};
  const commit=update=>{
    const task=writes.current.catch(()=>{}).then(async()=>{const next=typeof update==='function'?update(dataRef.current):update;await AsyncStorage.setItem(KEY,JSON.stringify(next));dataRef.current=next;if(mounted.current)setData(next);return next;});
    writes.current=task;return task;
  };
  const normalizeUser=user=>({...user,id:String(user.id),handle:String(user.handle||user.username||''),name:String(user.name||user.firstName||user.username||'Compte OwpenGram')});
  const normalizePost=post=>({...post,id:String(post.id),author:String(post.author),likes:post.likes==null?null:Number(post.likes),views:post.views==null?null:Number(post.views),allowComments:false});
  const storePosts=rows=>{const next=[...new Map(rows.filter(p=>p?.id&&p.media?.length).map(p=>[String(p.id),normalizePost(p)])).values()];postsRef.current=next;if(mounted.current)setPosts(next);AsyncStorage.setItem(postCacheKey,JSON.stringify({posts:next,feedIds:feedIdsRef.current,coverage:coverageRef.current})).catch(()=>notice('Le cache des publications n’a pas pu être enregistré.'));};
  const userOf=id=>String(id)===String(session.user.id)?dataRef.current.profile:profileCache[id]||remoteUsers.find(user=>user.id===id)||contacts.find(user=>user.id===id)||dialogs.filter(dialog=>dialog.recipientId===id).map(dialog=>({...dialog,id:dialog.recipientId,handle:dialog.username}))[0]||postsRef.current.filter(post=>post.author===id).map(post=>({id,name:post.authorName,handle:post.authorHandle,avatar:post.authorAvatar}))[0]||{id,name:'Compte OwpenGram',handle:''};
  const fetchUserPosts=async id=>{
    const result=[],seen=new Set();let cursor=null;
    do {const page=await request('/api/users/'+encodeURIComponent(id)+'/posts'+(cursor!=null?'?before='+encodeURIComponent(cursor):''));if(!Array.isArray(page.posts))throw Error('Liste de publications invalide.');result.push(...page.posts);cursor=page.nextCursor??null;if(cursor!=null){if(seen.has(String(cursor)))throw Error('Pagination de publications invalide.');seen.add(String(cursor));}} while(cursor!=null);
    return result;
  };
  const loadPosts=async(force=false)=>{
    if(postLock.current){await postLock.current;if(force)return loadPosts(false);return;}
    const revision=postRevision.current;
    const task=(async()=>{try{setPostState(postsRef.current.length?'cached':'loading');const [feed,own]=await Promise.all([request('/api/posts'),fetchUserPosts(session.user.id)]);if(!Array.isArray(feed.posts))throw Error('Fil de publications invalide.');if(revision!==postRevision.current)return;const ids=[...new Set([...feed.posts,...own].map(post=>String(post.id)))];feedIdsRef.current=ids;setFeedIds(ids);coverageRef.current=feed.coverage||null;setFeedCoverage(feed.coverage||null);const visible=new Set(ids);storePosts([...feed.posts,...own,...postsRef.current.filter(post=>!visible.has(post.id)&&String(post.author)!==String(session.user.id))]);setPostState('ready');}catch(e){if(revision!==postRevision.current)return;setPostState('error');notice(e);}})();
    postLock.current=task;try{await task;}finally{if(postLock.current===task)postLock.current=null;}
  };
  const loadContacts=async()=>{const response=await request('/api/users/contacts');if(!Array.isArray(response.users))throw Error('Liste de contacts invalide.');const users=response.users.map(normalizeUser);setContacts(users);return users;};
  const loadUsers=async term=>{const seq=++searchSequence.current;setSearching(true);setSearchError('');try{const value=String(term||'').trim();const result=await request(value?'/api/users/search?q='+encodeURIComponent(value):'/api/users/contacts');if(seq!==searchSequence.current)return;if(!Array.isArray(result.users))throw Error('Réponse de recherche invalide.');setRemoteUsers(result.users.map(normalizeUser));}catch(e){if(seq===searchSequence.current)setSearchError(e.message||'Recherche indisponible.');}finally{if(seq===searchSequence.current)setSearching(false);}};
  const loadProfile=async id=>{const response=await request(id===session.user.id?'/api/profile/me':'/api/users/'+encodeURIComponent(id)+'/profile');if(!response.profile)throw Error('Profil indisponible.');const profile=normalizeUser(response.profile);if(String(id)===String(session.user.id))await commit(old=>({...old,profile}));else setProfileCache(old=>({...old,[id]:profile}));return profile;};
  const loadConversations=async requestedRecipientId=>{
    const recipient=requestedRecipientId===undefined?activeChatRef.current:requestedRecipientId==null?null:String(requestedRecipientId);
    if(conversationLock.current){await conversationLock.current;if(requestedRecipientId!==undefined&&recipient===activeChatRef.current)return loadConversations(recipient);return;}
    const epoch=conversationEpoch.current;
    const task=(async()=>{try{const result=await request('/api/conversations');if(!Array.isArray(result.conversations))throw Error('Liste de conversations invalide.');if(epoch!==conversationEpoch.current)return;const list=result.conversations;setDialogs(list);setDialogHasMore(!!result.hasMore);list.forEach(dialog=>{remoteChatIds.current[String(dialog.recipientId)]=dialog.id;});
      if(!recipient||activeChatRef.current!==recipient)return;
      const conversation=list.find(dialog=>String(dialog.recipientId)===recipient)||{id:remoteChatIds.current[recipient]};if(!conversation.id)return;
      const response=await request('/api/conversations/'+encodeURIComponent(conversation.id)+'/messages');if(epoch!==conversationEpoch.current||activeChatRef.current!==recipient)return;if(!Array.isArray(response.messages))throw Error('Historique indisponible.');
      const messages=response.messages.slice().reverse().map(message=>({...bearNormalizeMessage(message,session.user.id),conversationId:conversation.id}));
      if(!historyRef.current[recipient]){historyRef.current[recipient]={before:response.nextBefore??null};setHistoryState({...historyRef.current});}
      const first=messages[0];const older=(dataRef.current.chats[recipient]||[]).filter(message=>first&&Number(message.id)<Number(first.id));
      await commit(old=>({...old,chats:{...old.chats,[recipient]:[...older,...messages]}}));
      if(activeChatRef.current===recipient)await request('/api/conversations/'+encodeURIComponent(conversation.id)+'/read',{method:'POST'});
    }catch(e){notice(e);}})();
    conversationLock.current=task;try{await task;}finally{if(conversationLock.current===task)conversationLock.current=null;}
  };
  const loadOlder=async recipient=>{
    const before=historyRef.current[recipient]?.before,cid=remoteChatIds.current[recipient];
    if(olderLock.current||before==null||!cid)return;
    olderLock.current=true;setLoadingOlder(true);const epoch=conversationEpoch.current;
    try{const response=await request('/api/conversations/'+encodeURIComponent(cid)+'/messages?before='+encodeURIComponent(before));if(activeChatRef.current!==recipient||epoch!==conversationEpoch.current)return;if(!Array.isArray(response.messages))throw Error('Historique indisponible.');
      const rows=response.messages.map(message=>({...bearNormalizeMessage(message,session.user.id),conversationId:cid}));
      await commit(old=>({...old,chats:{...old.chats,[recipient]:[...new Map([...rows,...(old.chats[recipient]||[])].map(message=>[message.id,message])).values()].sort((a,b)=>Number(a.id)-Number(b.id))}}));
      historyRef.current[recipient]={before:response.nextBefore??null};setHistoryState({...historyRef.current});
    }catch(e){notice(e);}finally{olderLock.current=false;setLoadingOlder(false);}
  };
  const refresh=async()=>{if(refreshing)return;setRefreshing(true);setError('');try{await Promise.all([loadPosts(),loadContacts(),loadProfile(session.user.id),loadConversations()]);}catch(e){notice(e);}finally{setRefreshing(false);}};
  useEffect(()=>{mounted.current=true;let alive=true;(async()=>{try{const [saved,cache,operation]=await Promise.all([AsyncStorage.getItem(KEY),AsyncStorage.getItem(postCacheKey),AsyncStorage.getItem(pendingKey)]);if(!alive)return;if(saved){const value=JSON.parse(saved);const next={profile:value.profile?.id===session.user.id?value.profile:nativeUser,drafts:Array.isArray(value.drafts)?value.drafts:[],chats:value.chats||{},chatMeta:value.chatMeta||{}};dataRef.current=next;setData(next);}if(cache){const cached=JSON.parse(cache),rows=Array.isArray(cached)?cached:cached.posts;if(Array.isArray(rows)){postsRef.current=rows;setPosts(rows);const ids=Array.isArray(cached.feedIds)?cached.feedIds:[];feedIdsRef.current=ids;setFeedIds(ids);coverageRef.current=cached.coverage||null;setFeedCoverage(cached.coverage||null);}}if(operation){const value=JSON.parse(operation);pendingRef.current=value;setPending(value);}}catch(e){notice('Les données locales n’ont pas pu être chargées. '+e.message);}finally{if(alive)setReady(true);}})();return()=>{alive=false;mounted.current=false;activeChatRef.current=null;conversationEpoch.current++;};},[namespace]);
  useEffect(()=>{if(ready)void refresh();},[ready]);
  useEffect(()=>{if(!ready||tab!=='contacts'||route)return;const timer=setTimeout(()=>loadUsers(query),250);return()=>clearTimeout(timer);},[query,tab,route,ready]);
  useEffect(()=>{if(!ready)return;const refreshMessages=()=>{if(AppState.currentState==='active')void loadConversations();};const timer=setInterval(refreshMessages,15000);const listener=AppState.addEventListener('change',state=>{if(state==='active')refreshMessages();});return()=>{clearInterval(timer);listener.remove();};},[ready,namespace]);
  useEffect(()=>{if(route?.type!=='profile'||!route.id)return;let alive=true;const id=String(route.id),revision=postRevision.current;Promise.all([loadProfile(id),fetchUserPosts(id)]).then(([,rows])=>{if(alive&&revision===postRevision.current)storePosts([...postsRef.current.filter(post=>post.author!==id),...rows]);}).catch(e=>{if(alive&&revision===postRevision.current)notice(e);});return()=>{alive=false;};},[route?.type,route?.id]);
  const back=()=>{activeChatRef.current=null;setRoute(null);setError('');};
  useEffect(()=>{if(!route||route.type==='chat'||route.type==='publish')return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{back();return true;});return()=>listener.remove();},[route?.type]);
  const openAccount=id=>{activeChatRef.current=null;if(String(id)===String(session.user.id)){setRoute(null);setTab('profile');}else setRoute({type:'profile',id:String(id)});};
  const openRemoteChat=async id=>{try{setError('');let cid=remoteChatIds.current[id];if(!cid){const result=await request('/api/conversations',{method:'POST',body:JSON.stringify(bearConversationRecipient(id,userOf(id)))});if(!result.conversationId)throw Error('La conversation n’a pas été confirmée.');cid=result.conversationId;remoteChatIds.current[id]=cid;}activeChatRef.current=String(id);setRoute({type:'chat',id:String(id)});await loadConversations(String(id));}catch(e){notice(e);}};
  const sendRemoteMessage=async(id,message)=>{
    let cid=remoteChatIds.current[id];if(!cid){const result=await request('/api/conversations',{method:'POST',body:JSON.stringify(bearConversationRecipient(id,userOf(id)))});cid=result.conversationId;if(!cid)throw Error('Conversation non confirmée.');remoteChatIds.current[id]=cid;}
    const clientMessageId=message.clientMessageId||(message.clientMessageId=uid());let sent;
    if(message.type==='text'){sent=await request('/api/conversations/'+encodeURIComponent(cid)+'/messages',{method:'POST',body:JSON.stringify({text:message.text,replyTo:message.reply?.id||null,clientMessageId})});}
    else {if(!message.uri)throw Error('Média introuvable.');const info=await FS.getInfoAsync(message.uri);if(!info.exists||info.size===0)throw Error('Le média sélectionné est introuvable.');if(message.type==='audio'&&(!(message.duration>0)||info.size<64))throw Error('Le vocal est vide ou trop court.');const prepared=message.type==='image'?await preparePhotoFile(message,FS,'message'):null;
      const media={...message,uri:prepared?.uri||message.uri,name:prepared?.name||message.fileName||'message',mimeType:prepared?.type||message.mimeType,durationSeconds:message.durationSeconds??Number(message.duration||0)/1000};
      sent=await owpenApi.sendMedia(cid,media,{clientMessageId,replyTo:message.reply?.id||null});}
    if(!sent?.success||!sent.messageId)throw Error('L’envoi n’a pas été confirmé. Ton brouillon est conservé.');
    await loadConversations(String(id));return sent;
  };
  const toggleContact=async id=>{if(contactLock.current)return;contactLock.current=true;setContactBusy(id);postRevision.current++;try{const exists=contacts.some(user=>user.id===id);await request('/api/users/'+encodeURIComponent(id)+'/contact',{method:exists?'DELETE':'POST',body:JSON.stringify(bearConversationRecipient(id,userOf(id)))});postRevision.current++;await loadContacts();await loadPosts(true);if(tab==='contacts')await loadUsers(query);}catch(e){notice(e);}finally{contactLock.current=false;setContactBusy(null);}};
  const react=async(post,emoji)=>{if(reactionLock.current)return;reactionLock.current=true;setReactionBusy(true);setReactionError('');postRevision.current++;try{const response=await request('/api/posts/'+encodeURIComponent(post.id)+'/reaction',{method:'POST',body:JSON.stringify({emoji})});if(!response.post)throw Error('Réaction non confirmée.');postRevision.current++;storePosts(postsRef.current.map(item=>item.id===post.id?response.post:item));setReactionPost(null);}catch(e){setReactionError(e.message);notice(e);}finally{reactionLock.current=false;setReactionBusy(false);}};
  const recordView=async post=>{try{await request('/api/posts/'+encodeURIComponent(post.id)+'/view',{method:'POST'});}catch(e){notice(e);}};
  const discardPending=async id=>{if(pendingRef.current&&(!id||pendingRef.current.id===id)){await AsyncStorage.removeItem(pendingKey);pendingRef.current=null;setPending(null);}};
  const commitPublication=async(post,isDraft,onProgress)=>{
    if(publicationLock.current)throw Error('Une publication est déjà en cours.');publicationLock.current=true;
    try{if(isDraft){await commit(old=>({...old,drafts:[post,...old.drafts.filter(item=>item.id!==post.id)]}));return;}
      bearValidatePublicationMedia(post.media);postRevision.current++;
      const previous=pendingRef.current||JSON.parse(await AsyncStorage.getItem(pendingKey)||'null');
      if(previous&&previous.id!==post.id)throw Error('Une publication attend une reprise. Reprends-la depuis la bannière.');
      const saved=previous||{...post,clientMessageId:post.clientMessageId||post.id||uid(),media:(await durableMedia(post.media)).media,visibility:'public'};
      // Persist the operation and its files before the first network request.
      await AsyncStorage.setItem(pendingKey,JSON.stringify(saved));pendingRef.current=saved;setPending(saved);
      const media={...saved.media[0],durationSeconds:saved.media[0].durationSeconds??Number(saved.media[0].duration||0)/1000};
      const response=saved.confirmedPost?{post:saved.confirmedPost}:await owpenApi.publish({media,caption:saved.caption,visibility:'public',clientMessageId:saved.clientMessageId},onProgress);
      if(!response?.post?.id)throw Error('Publication non confirmée. Le brouillon est conservé.');
      // The native receipt survives a cache-write failure and prevents automatic resends.
      const confirmed={...saved,confirmedPost:response.post};await AsyncStorage.setItem(pendingKey,JSON.stringify(confirmed));pendingRef.current=confirmed;setPending(confirmed);
      await commit(old=>({...old,drafts:old.drafts.filter(item=>item.id!==saved.id)}));
      await discardPending(saved.id);postRevision.current++;feedIdsRef.current=[...new Set([...feedIdsRef.current,response.post.id])];setFeedIds(feedIdsRef.current);storePosts([response.post,...postsRef.current.filter(item=>item.id!==response.post.id)]);setRecentPublicationId(response.post.id);setRoute(null);setTab('profile');onProgress?.(1,'Publication confirmée par OwpenGram');
    }finally{publicationLock.current=false;}
  };
  const resumePublication=()=>{if(!pendingRef.current)return;setRoute({type:'publish',draft:pendingRef.current,isPending:true});};
  const saveProfile=async profile=>{let confirmed=await request('/api/profile/me',{method:'PUT',body:JSON.stringify({name:profile.name,bio:profile.bio})});if(profile.avatarFile){const avatar=await owpenApi.setAvatar({...profile.avatarFile,type:'image'});if(!avatar?.profile)throw Error('La photo du profil n’a pas été confirmée.');confirmed=avatar;}const next=confirmed.profile?normalizeUser(confirmed.profile):await loadProfile(session.user.id);await commit(old=>({...old,profile:next}));setRoute(null);setTab('profile');};
  const saveCaption=async()=>{if(editLock.current||!editingPost)return;editLock.current=true;setEditBusy(true);postRevision.current++;try{const response=await request('/api/posts/'+encodeURIComponent(editingPost.id),{method:'PATCH',body:JSON.stringify({caption:editCaption})});postRevision.current++;if(response.post)storePosts(postsRef.current.map(post=>post.id===editingPost.id?response.post:post));else await loadPosts(true);setEditingPost(null);}catch(e){notice(e);}finally{editLock.current=false;setEditBusy(false);}};
  const deletePost=post=>Alert.alert('Supprimer cette publication ?','Elle sera supprimée du profil OwpenGram.',[{text:'Annuler',style:'cancel'},{text:'Supprimer',style:'destructive',onPress:async()=>{try{postRevision.current++;await request('/api/posts/'+encodeURIComponent(post.id),{method:'DELETE'});postRevision.current++;feedIdsRef.current=feedIdsRef.current.filter(id=>id!==post.id);setFeedIds(feedIdsRef.current);storePosts(postsRef.current.filter(item=>item.id!==post.id));setOptionsPost(null);if(route?.type==='post')back();}catch(e){notice(e);}}}]);
  const openPost=post=>setRoute({type:'post',id:post.id});
  const renderCard=(post,height,active)=><PostCard post={post} height={height} active={active} user={String(post.author)===String(session.user.id)?{...userOf(post.author),id:'me'}:userOf(post.author)} liked={!!post.myReaction} following={contacts.some(user=>user.id===post.author)} onLike={()=>react(post,'❤️')} onReaction={()=>{setReactionError('');setReactionPost(post);}} onFollow={()=>toggleContact(post.author)} onProfile={()=>openAccount(post.author)} onMore={()=>setOptionsPost(post)} onView={()=>recordView(post)}/>;
  const feedPosts=posts.filter(post=>feedIds.includes(post.id));
  const ownPosts=posts.filter(post=>String(post.author)===String(session.user.id));
  let content;
  if(!ready)content=<View style={[s.flex,s.center]}><ActivityIndicator color={CYAN}/></View>;
  else if(route?.type==='gallery')content=<BearStoryGallery forPublication theme={theme} onBack={back} onDrafts={()=>setRoute({type:'drafts'})} onSelect={media=>setRoute({type:'publish',media})}/>;
  else if(route?.type==='publish')content=<Publisher key={route.draft?.id||route.media?.[0]?.uri||'publication'} draft={route.draft} initialMedia={route.media} isPending={!!route.isPending} onDiscardPending={discardPending} onCommit={commitPublication} onClose={()=>{back();setTab('profile');}} theme={theme}/>;
  else if(route?.type==='edit')content=<EditProfile profile={data.profile} onSave={saveProfile} onBack={back}/>;
  else if(route?.type==='settings')content=<PulseSettings onBack={back} onDrafts={()=>setRoute({type:'drafts'})} onProfile={()=>setRoute({type:'edit'})} onLogout={onLogout} theme={theme} onThemeChange={chooseTheme} language={language} onLanguageChange={onLanguageChange}/>;
  else if(route?.type==='drafts')content=<View style={{flex:1,backgroundColor:ui.bg}}><Header title="Brouillons" onBack={back}/><ScrollView contentContainerStyle={{padding:15}}>{data.drafts.map(draft=><View key={draft.id} style={{padding:12,marginBottom:12,backgroundColor:ui.panel,borderRadius:12}}><Tap onPress={()=>setRoute({type:'publish',draft})} style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{width:70,height:90}}><MediaThumb media={draft.media[0]}/></View><Text style={{color:ui.text,flex:1}}>{draft.caption||'Sans description'}{draft.media.length>1?' · plusieurs médias à séparer':''}</Text></Tap><Tap onPress={()=>Alert.alert('Supprimer ce brouillon ?','Cette action retire le brouillon de ce téléphone.',[{text:'Annuler',style:'cancel'},{text:'Supprimer',style:'destructive',onPress:()=>commit(old=>({...old,drafts:old.drafts.filter(item=>item.id!==draft.id)})).catch(notice)}])} style={{paddingTop:12}}><Text style={{color:'#ff9d9d'}}>Supprimer le brouillon</Text></Tap></View>)}{!data.drafts.length&&<Text style={{padding:25,color:ui.muted}}>Aucun brouillon sur ce téléphone.</Text>}</ScrollView></View>;
  else if(route?.type==='profile')content=<PublicProfile user={userOf(route.id)} posts={posts.filter(post=>post.author===route.id)} isContact={contacts.some(user=>user.id===route.id)} contactBusy={contactBusy===route.id} onContact={()=>toggleContact(route.id)} onMessage={()=>openRemoteChat(route.id)} onBack={back} onOpen={openPost} theme={theme} refreshing={refreshing} onRefresh={async()=>{setRefreshing(true);const revision=postRevision.current;try{const [,rows]=await Promise.all([loadProfile(route.id),fetchUserPosts(route.id)]);if(revision===postRevision.current)storePosts([...postsRef.current.filter(post=>post.author!==route.id),...rows]);}catch(e){notice(e);}finally{setRefreshing(false);}}}/>;
  else if(route?.type==='post')content=<View style={{flex:1}}><Header title="Publication" onBack={back}/><Feed posts={posts.filter(post=>post.id===route.id)} renderCard={renderCard}/></View>;
  else if(route?.type==='chat')content=<Chat key={session.user.id+':'+route.id} user={userOf(route.id)} messages={data.chats[route.id]||[]} onSend={message=>sendRemoteMessage(route.id,message)} onBack={back} hasOlder={historyState[route.id]?.before!=null} loadingOlder={loadingOlder} onLoadOlder={()=>loadOlder(route.id)} sessionUserId={namespace} theme={theme}
    onChatSettings={ttlSeconds=>{const cid=remoteChatIds.current[route.id];if(!cid)throw Error('Discussion inconnue.');return request('/api/conversations/'+encodeURIComponent(cid)+'/settings',ttlSeconds===undefined?undefined:{method:'PUT',body:JSON.stringify({ttlSeconds})});}}
    onClearConversation={async()=>{const cid=remoteChatIds.current[route.id];if(!cid)throw Error('Discussion inconnue.');await request('/api/conversations/'+encodeURIComponent(cid),{method:'DELETE'});conversationEpoch.current++;await commit(old=>({...old,chats:{...old.chats,[route.id]:[]}}));setDialogs(old=>old.filter(dialog=>dialog.id!==cid));delete remoteChatIds.current[route.id];delete historyRef.current[route.id];setHistoryState({...historyRef.current});}}
    onDelete={async id=>{try{const cid=remoteChatIds.current[route.id];await request('/api/conversations/'+encodeURIComponent(cid)+'/messages/'+encodeURIComponent(id),{method:'DELETE'});await loadConversations(route.id);}catch(e){notice(e);}}}
    onReact={async(id,emoji)=>{try{const cid=remoteChatIds.current[route.id];await request('/api/conversations/'+encodeURIComponent(cid)+'/messages/'+encodeURIComponent(id)+'/reaction',{method:'POST',body:JSON.stringify({emoji})});await loadConversations(route.id);}catch(e){notice(e);}}}/>;
  else if(tab==='profile')content=<Profile user={data.profile} own posts={ownPosts} drafts={data.drafts} onEdit={()=>setRoute({type:'edit'})} onSettings={()=>setRoute({type:'settings'})} onOpen={openPost} onDraft={()=>setRoute({type:'drafts'})} onCreate={()=>setRoute({type:'gallery'})} recentPublicationId={recentPublicationId} theme={theme} refreshing={refreshing} onRefresh={refresh}/>;
  else if(tab==='inbox')content=<Inbox chats={data.chats} hasMore={dialogHasMore} meta={data.chatMeta} onMeta={(id,patch)=>commit(old=>({...old,chatMeta:{...old.chatMeta,[id]:{...old.chatMeta[id],...patch}}})).catch(notice)} remoteUsers={dialogs.map(dialog=>({...dialog,id:String(dialog.recipientId),handle:dialog.username||''}))} onChat={openRemoteChat} onNewChat={()=>setTab('contacts')} refreshing={refreshing} onRefresh={refresh} theme={theme}/>;
  else if(tab==='contacts')content=<NativeContacts users={remoteUsers} contacts={contacts.map(user=>user.id)} query={query} onQuery={setQuery} onProfile={openAccount} onMessage={openRemoteChat} onContact={toggleContact} busy={contactBusy} loading={searching} error={searchError} onRefresh={()=>loadUsers(query)} theme={theme}/>;
  else content=<View style={{flex:1}}><Header title="Contacts" right={<Tap onPress={refresh} label="Actualiser les publications"><Icon name="refresh" color={ui.text}/></Tap>}/>{feedCoverage&&(feedCoverage.partial||feedCoverage.truncated)&&<Text style={{color:ui.muted,fontSize:12,paddingHorizontal:15,paddingBottom:10}}>Fil partiel : {feedCoverage.contactsIncluded}/{feedCoverage.contactsAvailable} contacts, au plus {feedCoverage.maxPostsPerProfile} publications par profil.{feedCoverage.profilesFailed?' '+feedCoverage.profilesFailed+' profil(s) indisponible(s).':''} Actualise pour réessayer.</Text>}{feedPosts.length?<Feed posts={feedPosts} renderCard={renderCard} refreshing={refreshing} onRefresh={refresh}/>:<Empty icon="images-outline" title={postState==='loading'?'Chargement des publications…':postState==='error'?'Publications indisponibles':'Aucune publication chargée'} body="Le fil affiche les publications OwpenGram de tes contacts et de ton profil." action="Actualiser" onPress={refresh}/>}</View>;
  return <View style={{flex:1,backgroundColor:ui.bg,paddingTop:insets.top}}><StatusBar barStyle={theme==='white'?'dark-content':'light-content'} backgroundColor={ui.bg}/>
    {!!error&&<View style={{backgroundColor:'#492529',padding:11,flexDirection:'row',gap:8}}><Tap onPress={refresh} style={{flex:1}} label="Réessayer la synchronisation"><Text style={{color:'#ffe7e7',fontSize:12}}>{error} · Réessayer</Text></Tap><Tap label="Fermer le message" onPress={()=>setError('')}><Icon name="close" size={19} color="white"/></Tap></View>}
    {!!pending&&route?.type!=='publish'&&<Tap onPress={resumePublication} label="Reprendre la publication" style={{backgroundColor:'#28466a',padding:12}}><Text style={{color:'white'}}>{pending.confirmedPost?'Publication reçue : terminer la sauvegarde':'Publication en attente : reprendre le brouillon'}</Text></Tap>}
    <View style={{flex:1}}>{content}</View>
    {!route&&<View style={{flexDirection:'row',backgroundColor:ui.panel,paddingBottom:Math.max(8,insets.bottom),paddingTop:10,borderTopWidth:1,borderTopColor:ui.border}}>{[['feed','home-outline','Contacts'],['contacts','search-outline','Rechercher'],['create','add-circle','Publier'],['inbox','chatbubbles-outline','Messages'],['profile','person-outline','Profil']].map(([id,icon,label])=><Tap key={id} label={label} onPress={()=>{activeChatRef.current=null;if(id==='create')setRoute({type:'gallery'});else{setTab(id);setError('');}}} style={{flex:1,alignItems:'center',gap:4}}><Icon name={icon} size={id==='create'?32:24} color={tab===id?CYAN:ui.text}/><Text style={{fontSize:10,color:tab===id?CYAN:ui.muted}}>{label}</Text></Tap>)}</View>}
    <Modal visible={!!reactionPost} transparent animationType="fade" onRequestClose={()=>{if(!reactionBusy)setReactionPost(null);}}><View style={{flex:1,backgroundColor:'#0009',justifyContent:'flex-end'}}><Tap disabled={reactionBusy} style={{flex:1}} onPress={()=>setReactionPost(null)}/><View style={{padding:22,backgroundColor:ui.panel}}><Text style={{color:ui.text,fontWeight:'800',fontSize:20}}>Réagir à la publication</Text><View style={{flexDirection:'row',justifyContent:'space-around',marginVertical:22}}>{['❤️','👍','😂','🔥','😮','😢'].map(emoji=><Tap key={emoji} label={'Réagir '+emoji} disabled={reactionBusy} onPress={()=>react(reactionPost,emoji)}><RNText style={{fontSize:30}}>{emoji}</RNText></Tap>)}</View>{reactionBusy&&<ActivityIndicator color={CYAN}/>} {!!reactionError&&<Text style={{color:'#ff9d9d',marginBottom:12}}>{reactionError}</Text>}{!!reactionPost?.myReaction&&<Button secondary title="Retirer ma réaction" disabled={reactionBusy} onPress={()=>react(reactionPost,null)}/>}<Button secondary title="Fermer" disabled={reactionBusy} onPress={()=>setReactionPost(null)} style={{marginTop:12}}/></View></View></Modal>
    <Modal visible={!!optionsPost} transparent onRequestClose={()=>setOptionsPost(null)}><View style={{flex:1,backgroundColor:'#0009',justifyContent:'flex-end'}}><Tap style={{flex:1}} onPress={()=>setOptionsPost(null)}/><View style={{backgroundColor:ui.panel,padding:22}}>{String(optionsPost?.author)===String(session.user.id)?<><Button title="Modifier la description" secondary onPress={()=>{setEditingPost(optionsPost);setEditCaption(optionsPost.caption||'');setOptionsPost(null);}}/><Button title="Supprimer la publication" secondary onPress={()=>deletePost(optionsPost)} style={{marginTop:12}}/></>:<Button title="Voir le profil" onPress={()=>{openAccount(optionsPost.author);setOptionsPost(null);}}/>}<Button title="Fermer" secondary style={{marginTop:12}} onPress={()=>setOptionsPost(null)}/></View></View></Modal>
    <Modal visible={!!editingPost} animationType="slide" onRequestClose={()=>{if(!editBusy)setEditingPost(null);}}><View style={{flex:1,backgroundColor:ui.bg,paddingTop:insets.top}}><Header title="Modifier la description" onBack={editBusy?undefined:()=>setEditingPost(null)}/><BearFormScroll contentContainerStyle={{padding:20}}><TextInput accessibilityLabel="Description de la publication" value={editCaption} onChangeText={setEditCaption} multiline editable={!editBusy} maxLength={1024} style={[s.field,{minHeight:150}]}/><Button title={editBusy?'Enregistrement…':'Enregistrer'} disabled={editBusy} onPress={saveCaption} style={{marginTop:16}}/>{!!error&&<Text style={{color:'#ff9d9d',marginTop:15}}>{error}</Text>}</BearFormScroll></View></Modal>
  </View>;
}


// Logo Bear Like embarqué : fonctionne dans Expo Go sans hébergement externe.
const BEAR_AUTH_VIDEO = require('./assets/auth-background.mp4');
function AuthBackground() {
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(BEAR_AUTH_VIDEO, p => {
    p.loop = true; p.muted = false; p.volume = 1;
    p.audioMixingMode = 'auto'; p.staysActiveInBackground = false;
  });
  useEffect(() => {
    let mounted = true, failedPlayback = false;
    let status, appState;
    const pause = () => {
      try { player.pause(); } catch (_) { /* useVideoPlayer may already have released it. */ }
    };
    const fail = () => {
      if (!mounted || failedPlayback) return;
      failedPlayback = true;
      console.warn('[BearLike] Auth video playback failed');
      pause();
      setFailed(true);
    };
    const sync = state => {
      if (!mounted || failedPlayback) return;
      try { if (state === 'active') player.play(); else player.pause(); }
      catch (_) { fail(); }
    };
    try {
      status = player.addListener('statusChange', event => {
        if (event.status === 'error') fail();
      });
      appState = AppState.addEventListener('change', sync);
      // A fast source error may precede subscription registration.
      if (player.status === 'error') fail();
      else sync(AppState.currentState);
    } catch (_) { fail(); }
    return () => {
      mounted = false;
      try { appState?.remove(); } catch (_) {}
      try { status?.remove(); } catch (_) {}
      pause(); // Native release itself belongs to useVideoPlayer.
    };
  }, [player]);
  return <View pointerEvents="none" style={[StyleSheet.absoluteFillObject,{backgroundColor:'#000000'}]}>{!failed&&<VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} surfaceType="textureView" />}</View>;
}
function PulseAuth({ onAuthenticated }) {
  return <OwpenGramAuth onAuthenticated={onAuthenticated} Background={AuthBackground} FormScroll={BearFormScroll} TextComponent={Text} InputComponent={TextInput} />;
}
function PulseEntry() {
  const [language,setLanguage]=useState('fr'),languageTouched=useRef(false),languageWrites=useRef(Promise.resolve());
  const changeLanguage=code=>{if(!['fr','en','es'].includes(code))return;languageTouched.current=true;bearLanguage=code;setLanguage(code);languageWrites.current=languageWrites.current.catch(()=>{}).then(()=>AsyncStorage.setItem(BEAR_LANG_KEY,code));languageWrites.current.catch(()=>Alert.alert('Bear Like','La langue n’a pas pu être enregistrée.'));};
  useEffect(()=>{let live=true;AsyncStorage.getItem(BEAR_LANG_KEY).then(code=>{if(live&&!languageTouched.current&&['fr','en','es'].includes(code)){bearLanguage=code;setLanguage(code);}}).catch(()=>{});return()=>{live=false;};},[]);
  const [session,setSession]=useState(null),[checking,setChecking]=useState(true),[sessionReadError,setSessionReadError]=useState(''),[sessionReadAttempt,setSessionReadAttempt]=useState(0);
  useEffect(()=>{let active=true;setChecking(true);setSessionReadError('');(async()=>{const saved=await authClient.load();if(!active||!saved)return;let verified;try{verified=await authClient.validate(saved);}catch(error){if(error.status===401)return;throw error;}if(active)setSession(verified);})().catch(error=>{if(active)setSessionReadError(error.message||'Connexion indisponible.');}).finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[sessionReadAttempt]);
  if(checking)return <View style={{flex:1,backgroundColor:'#0A142B',justifyContent:'center'}}><ActivityIndicator color={CYAN} size="large"/></View>;
  if(sessionReadError)return <View style={{flex:1,backgroundColor:'#0A142B',justifyContent:'center',padding:24}}><Text style={{color:'white',marginBottom:15}}>Impossible de vérifier la session OwpenGram enregistrée. Tes données sont conservées.</Text><Text style={{color:'#ff9d9d',marginBottom:20}}>{sessionReadError}</Text><Pressable accessibilityRole="button" accessibilityLabel="Réessayer le chargement de la session" onPress={()=>setSessionReadAttempt(value=>value+1)} style={{padding:16}}><Text style={{color:CYAN}}>Réessayer</Text></Pressable></View>;
  const logout=async()=>{await authClient.logout(session);setSession(null);};
  return session?<Main key={accountNamespace(session.user.id)} session={session} language={language} onLanguageChange={changeLanguage} onLogout={logout}/>:<PulseAuth onAuthenticated={value=>setSession(value)}/>;
}
export default function App() {
  return (
    <SafeAreaProvider>
      <PulseEntry />
    </SafeAreaProvider>
  );
}

const s = {
  flex: { flex: 1 },
  fill: { ...StyleSheet.absoluteFillObject },
  center: { justifyContent: "center", alignItems: "center" },
  centerFill: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  whitePage: { flex: 1, backgroundColor: "#fff" },
  white: { color: "#fff", fontSize: 14 },
  smallWhite: { color: "#fff", fontSize: 12 },
  bold: { fontSize: 15, fontWeight: "700", color: "#161823" },
  muted: { color: "#86878B", fontSize: 13, lineHeight: 19 },
  body: { fontSize: 15, color: "#333", lineHeight: 23 },
  row: { flexDirection: "row", alignItems: "center" },
  header: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ededed",
    backgroundColor: "#fff",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#111",
    fontSize: 17,
    fontWeight: "700",
  },
  iconButton: { padding: 10 },
  button: {
    backgroundColor: RED,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 18,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 5,
  },
  secondary: {
    backgroundColor: "#f2f2f2",
    borderWidth: 1,
    borderColor: "#e8e8e8",
  },
  buttonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  avatar: {
    backgroundColor: "#eee",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 65,
    paddingHorizontal: 30,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#555",
    textAlign: "center",
    marginVertical: 7,
  },
  feedTop: {
    position: "absolute",
    top: 15,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rail: {
    position: "absolute",
    right: 9,
    bottom: 58,
    alignItems: "center",
    width: 56,
  },
  railButton: { alignItems: "center", marginBottom: 19 },
  railText: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
    textShadowColor: "#0008",
    textShadowRadius: 3,
  },
  followBadge: {
    position: "absolute",
    bottom: -9,
    alignSelf: "center",
    width: 23,
    height: 23,
    borderRadius: 13,
    backgroundColor: RED,
    alignItems: "center",
    justifyContent: "center",
  },
  record: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderColor: "#454b58",
    borderWidth: 3,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomShade: {
    position: "absolute",
    bottom: 25,
    left: 0,
    right: 0,
    height: 150,
    backgroundColor: "#00000024",
  },
  captionBlock: { position: "absolute", bottom: 13, left: 14, right: 83 },
  caption: {
    color: "white",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 9,
    marginBottom: 10,
    textShadowColor: "#000",
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 1 },
  },
  localBadge: { color: CYAN, fontSize: 11, marginBottom: 7 },
  photoCounter: {
    position: "absolute",
    left: 16,
    bottom: 38,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    minWidth: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  photoCounterText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  timelineWrap: { position: "absolute", bottom: 0, left: 0, right: 0 },
  timeLabel: {
    color: "#ddd",
    fontSize: 10,
    alignSelf: "flex-end",
    marginRight: 12,
  },
  seekHit: { height: 22, justifyContent: "center" },
  timeline: { height: 3, backgroundColor: "#ffffff35" },
  timelineFill: { height: 3, backgroundColor: "#fff" },
  bottomNav: {
    height: 51,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navItem: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    height: 50,
  },
  createOuter: {
    width: 43,
    height: 28,
    backgroundColor: CYAN,
    borderRadius: 8,
    borderRightWidth: 4,
    borderRightColor: RED,
    paddingLeft: 4,
  },
  createInner: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHead: {
    alignItems: "center",
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  handle: { fontSize: 17, fontWeight: "700", marginTop: 13 },
  stats: { flexDirection: "row", paddingVertical: 22, gap: 29 },
  stat: { alignItems: "center" },
  statNumber: { fontSize: 19, fontWeight: "800", marginBottom: 3 },
  bio: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 20,
    textAlign: "center",
    color: "#333",
  },
  localNote: { fontSize: 11, color: "#999", marginTop: 10 },
  profileTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  profileTab: {
    flex: 1,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  tabSelected: { borderColor: "#111" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  thumbTop: { position: "absolute", right: 7, top: 7 },
  thumbBottom: {
    position: "absolute",
    bottom: 7,
    left: 6,
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
  },
  draftTile: {
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#f0f0f1",
  },
  pageTitle: { fontSize: 27, fontWeight: "800", margin: 18, marginBottom: 15 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 12,
    backgroundColor: "#f1f1f2",
    borderRadius: 8,
    gap: 8,
    minHeight: 44,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: "#111" },
  categoryRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 16,
    paddingHorizontal: 16,
    flexWrap: "wrap",
  },
  chip: {
    borderRadius: 7,
    backgroundColor: "#f2f2f2",
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  chipSelected: { backgroundColor: "#161823" },
  trendCard: {
    margin: 16,
    marginTop: 0,
    padding: 20,
    backgroundColor: "#10363D",
    borderRadius: 14,
    overflow: "hidden",
  },
  eyebrow: { color: CYAN, fontWeight: "800", fontSize: 10, letterSpacing: 2 },
  trendTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "white",
    marginTop: 12,
  },
  trendChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#ffffff15",
    borderRadius: 6,
    marginRight: 8,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", margin: 18 },
  infoBox: {
    flexDirection: "row",
    gap: 9,
    margin: 16,
    padding: 13,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  chatNotice: {
    textAlign: "center",
    color: "#888",
    fontSize: 12,
    padding: 12,
    backgroundColor: "#f7f7f7",
  },
  message: {
    alignSelf: "flex-end",
    backgroundColor: "#e6f8f6",
    borderRadius: 14,
    borderBottomRightRadius: 3,
    padding: 13,
    marginBottom: 12,
    maxWidth: "85%",
  },
  messageTime: {
    fontSize: 10,
    color: "#798783",
    textAlign: "right",
    marginTop: 7,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  messageInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderRadius: 21,
    backgroundColor: "#f2f2f2",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    color: "#111",
    fontSize: 14,
  },
  send: {
    width: 42,
    height: 42,
    backgroundColor: RED,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: { flex: 1, backgroundColor: "#0007" },
  commentSheet: {
    height: "66%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 17,
    borderTopRightRadius: 17,
    overflow: "hidden",
  },
  sheetTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  commentAvatar: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: "#eee",
    alignItems: "center",
    justifyContent: "center",
  },
  captureMark: {
    alignSelf: "center",
    height: 105,
    width: 105,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: CYAN,
    borderRightColor: RED,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTools: {
    position: "absolute",
    right: 12,
    top: 12,
    alignItems: "flex-end",
    gap: 10,
  },
  toolPill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#0009",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  bottomActions: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  captionInput: {
    flex: 1,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 23,
    paddingVertical: 8,
    color: "#111",
  },
  previewThumb: {
    width: 85,
    height: 116,
    backgroundColor: "#222",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    overflow: "hidden",
    gap: 10,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  settingText: { flex: 1, fontSize: 14, color: "#222" },
  publishTrack: {
    width: "75%",
    height: 6,
    backgroundColor: "#eee",
    borderRadius: 3,
    overflow: "hidden",
    marginVertical: 20,
  },
  publishFill: { height: 6, backgroundColor: RED },
  field: {
    borderBottomWidth: 1,
    borderColor: "#ddd",
    paddingVertical: 12,
    fontSize: 16,
    color: "#111",
  },
  toast: {
    position: "absolute",
    left: 28,
    right: 28,
    backgroundColor: "#222e",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  floatingBack: {
    position: "absolute",
    top: 12,
    left: 12,
    padding: 7,
    borderRadius: 25,
    backgroundColor: "#0006",
  },
};


// Theme colors apply only to UI surfaces; never recolor the video/photo canvas.
const PULSE_THEMES = {
  white: { bg: "#FFFFFF", panel: "#FFFFFF", soft: "#F5F5F5", text: "#161823", muted: "#86878B", border: "#EEEEEE" },
  dark: { bg: "#000000", panel: "#1C1C1E", soft: "#151515", text: "#FFFFFF", muted: "#B0B0B6", border: "#343438" },
  navy: { bg: "#0B1426", panel: "#14213A", soft: "#101B30", text: "#F4F7FF", muted: "#A9B9D2", border: "#263650" },
};
const PULSE_THEME_KEYS = {
  s: {
    whitePage: ["backgroundColor"], bold: ["color"], muted: ["color"], body: ["color"],
    header: ["backgroundColor", "borderBottomColor"], headerTitle: ["color"],
    secondary: ["backgroundColor", "borderColor"], avatar: ["backgroundColor"],
    emptyTitle: ["color"], handle: ["color"], bio: ["color"],
    profileHead: ["backgroundColor"], profileTabs: ["backgroundColor"],
    personRow: ["borderColor"], settingRow: ["borderColor"], settingText: ["color"],
    captionInput: ["color"], field: ["color", "borderColor"],
    bottomActions: ["borderColor"], commentAvatar: ["backgroundColor"],
  },
  manage: { panel: ["backgroundColor"], heading: ["color"], optionText: ["color"], input: ["color", "borderColor"] },
};
const PULSE_BASE_STYLES = {
  s: Object.fromEntries(Object.entries(s).map(([k,v]) => [k, {...v}])),
};
function applyPulseTheme(theme) {
  const colors = PULSE_THEMES[theme] || PULSE_THEMES.navy;
  const map = {
    "#fff": colors.bg, "#FFFFFF": colors.bg, "white": colors.panel,
    "#f5f5f5": colors.soft, "#f2f2f2": colors.soft, "#eee": colors.border,
    "#ededed": colors.border, "#e8e8e8": colors.border, "#ddd": colors.border,
    "#111": colors.text, "#151515": colors.text, "#161823": colors.text,
    "#222": colors.text, "#333": colors.text, "#555": colors.text,
    "#888": colors.muted, "#999": colors.muted, "#86878B": colors.muted,
  };
  for (const [group, styles] of Object.entries({s})) {
    for (const [name, keys] of Object.entries(PULSE_THEME_KEYS[group])) {
      if (!styles[name]) continue;
      const themedStyle = { ...styles[name] };
      for (const key of keys) {
        const original = PULSE_BASE_STYLES[group][name]?.[key];
        if (original !== undefined) themedStyle[key] = theme === "white" ? original : (map[original] || original);
      }
      styles[name] = themedStyle;
    }
  }
}
