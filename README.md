# Armario de Noelia

Aplicación web responsive para un armario virtual privado.

## Arquitectura

- Frontend estático: HTML/CSS/JS, apto para GitHub Pages o Firebase Hosting.
- Firebase Authentication: acceso por email + contraseña y recuperación por email.
- Cloud Firestore: prendas, atuendos, puntuaciones y registro de uso.
- Firebase Storage: imágenes de modelo/prendas/resultados.
- Firebase Functions: creación de la única cuenta de Noelia desde la propia web y adaptación de prendas con Gemini.
- IA: `gemini-3.1-flash-image` mediante una Function, para que la API key no quede expuesta en el navegador.
- La composición de atuendos se hace en el navegador, sin volver a llamar a la IA.

> Importante: Firebase Cloud Storage actualmente requiere el plan Blaze. Firestore mantiene cuota gratuita, pero la IA y las funciones pueden generar consumo. Configurá alertas de presupuesto antes de usarla en producción.

## 1. Crear el proyecto Firebase

1. Crear un proyecto en Firebase.
2. Activar Authentication > Sign-in method > Email/Password.
3. Crear Firestore Database.
4. Crear Storage.
5. Agregar una Web App y copiar su configuración.
6. Copiar `firebase-config.example.js` como `firebase-config.js` y completar los valores.
7. En Authentication > Settings > Authorized domains agregar el dominio de GitHub Pages, por ejemplo:
   `tuusuario.github.io`.

## 2. Crear exactamente los dos usuarios

Juan se configura una sola vez como administrador desde Firebase Authentication/Firestore. **Noelia NO se crea previamente.**

1. Crear manualmente en Firebase Authentication el usuario de Juan.
2. Crear `users/{UID_DE_JUAN}` en Firestore con `email`, `role: admin` y `displayName: Juan`.
3. Publicar la web y enviarle el link a Noelia.
4. Noelia pulsa **Crear cuenta de Noelia** y registra ella misma su email y contraseña.
5. La Function `registerNoelia` crea su usuario en Firebase Authentication y su perfil `role: user`.
6. Una vez creada esa cuenta, el registro queda cerrado: no se puede crear una tercera cuenta desde la web.

Por lo tanto, Juan no necesita crearle ni configurar previamente la cuenta a Noelia. Ella se registra y recupera su contraseña por sí misma.

## 3. Configurar la IA

La Function usa una variable secreta:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

Luego desplegar:

```bash
firebase deploy --only functions
```

La API key nunca se coloca en `app.js`.

## 4. Desplegar

### GitHub Pages

Subí el contenido del proyecto a GitHub y activá Pages desde Settings > Pages > Deploy from branch.

### Firebase Hosting

También podés usar:

```bash
firebase login
firebase use TU_PROJECT_ID
firebase deploy --only hosting
```

## 5. Modelo inicial

La foto entregada está en:

`assets/model.jpg`

El usuario puede reemplazarla desde el panel de configuración de su cuenta. La imagen se guarda como la "modelo" de ese usuario.

## Nota sobre la IA y la composición

La IA genera una versión de la prenda alineada visualmente con la modelo. Para que la composición por capas sea realmente precisa, el resultado ideal debe ser un PNG transparente del área de la prenda en un lienzo del mismo tamaño que la modelo.

La Function incluida intenta solicitar ese formato a Gemini. La calidad final depende del modelo de IA y de la fotografía de la prenda. El sistema además permite guardar manualmente una imagen adaptada si una generación necesita corrección.

## Seguridad

- El frontend oculta el panel de administración a usuarios normales.
- Las reglas de Firestore/Storage también restringen el acceso; no se depende solamente de ocultar botones.
- Juan puede ver y administrar los datos de ambos usuarios.
- Noelia solo puede leer y modificar sus propias prendas, atuendos, modelo y registros.
- No existe registro público de usuarios.
- Las reglas impiden que una usuaria cambie su propio rol de `user` a `admin`.
- El Storage también permite a Juan visualizar los archivos de Noelia.
- No publiques claves privadas en GitHub.
