/**
 * Persian: the site's language, and the source of truth for every key.
 *
 * The shape of this object is the shape every other language must match: the
 * type of `en` is derived from it, so a key added here and forgotten there is
 * a type error, not a blank label in production.
 */
export const fa = {
  app: {
    name: "شاه‌کلید",
  },
  common: {
    loading: "در حال بارگذاری…",
    retry: "تلاش دوباره",
    save: "ذخیره",
    cancel: "انصراف",
    close: "بستن",
    back: "بازگشت",
  },
  errors: {
    generic: "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.",
    offline: "اتصال اینترنت برقرار نیست.",
    /**
     * One sentence for every error code the API can answer with
     * (AUTH_ERROR_CODES in @shah-kelid/contracts). Form fields show these too:
     * the shared schemas use the codes as their messages.
     */
    codes: {
      VALIDATION_FAILED: "برخی از مقادیر درست وارد نشده‌اند.",
      EMAIL_INVALID: "یک ایمیل معتبر وارد کنید.",
      PASSWORD_TOO_SHORT: "رمز عبور باید دست‌کم ۸ نویسه باشد.",
      PASSWORD_TOO_LONG: "رمز عبور حداکثر ۱۲۸ نویسه می‌تواند باشد.",
      PASSWORD_REQUIRED: "رمز عبور را وارد کنید.",
      CODE_INVALID: "کد را کامل وارد کنید.",
      CODE_EXPIRED: "این کد دیگر معتبر نیست. یک کد تازه بگیرید.",
      CODE_WRONG: "کد درست نیست. دوباره نگاه کنید و وارد کنید.",
      TOO_MANY_CODES: "کد زیادی درخواست شده است. {{wait}} دیگر دوباره تلاش کنید.",
      WRONG_CREDENTIALS: "ایمیل یا رمز عبور درست نیست.",
      ACCOUNT_LOCKED:
        "به‌خاطر چند تلاش ناموفق، این راه ورود تا {{wait}} دیگر بسته است.",
      ACCOUNT_SUSPENDED: "این حساب غیرفعال شده است. با پشتیبانی تماس بگیرید.",
      SIGN_IN_REQUIRED: "ابتدا وارد حساب خود شوید.",
      TWO_FACTOR_REQUIRED: "کد ورود دومرحله‌ای را وارد کنید.",
      TWO_FACTOR_SETUP_REQUIRED: "ابتدا ورود دومرحله‌ای را راه‌اندازی کنید.",
      TWO_FACTOR_ALREADY_ENABLED: "ورود دومرحله‌ای از قبل فعال است.",
      FORBIDDEN: "به این بخش دسترسی ندارید.",
      RATE_LIMITED: "درخواست‌ها زیاد بود. {{wait}} دیگر دوباره تلاش کنید.",
      CROSS_ORIGIN: "این درخواست از نشانی دیگری آمده بود و پذیرفته نشد.",
      NOT_FOUND: "پیدا نشد.",
      CONFLICT: "این کار در وضعیت فعلی ممکن نیست. صفحه را تازه کنید.",
      INTERNAL: "خطایی در سرور رخ داد. کمی بعد دوباره تلاش کنید.",
    },
    wait: {
      seconds: "{{amount}} ثانیه",
      minutes: "{{amount}} دقیقه",
      unknown: "چند دقیقه",
    },
  },
  account: {
    signIn: {
      title: "ورود به شاه‌کلید",
      subtitle: "با ایمیل وارد شوید. اگر حساب ندارید، همین‌جا ساخته می‌شود.",
      email: "ایمیل",
      emailPlaceholder: "you@example.com",
      sendCode: "ارسال کد ورود",
      sending: "در حال ارسال…",
      usePassword: "ورود با رمز عبور",
      useCode: "ورود با کد ایمیلی",
      password: "رمز عبور",
      passwordPlaceholder: "رمز عبور خود را وارد کنید",
      submit: "ورود",
      signingIn: "در حال ورود…",
      forgotPassword: "رمز را فراموش کرده‌اید؟",
      lockedHint: "تا آن موقع می‌توانید با کد ایمیلی وارد شوید.",
      welcome: "خوش آمدید.",
    },
    code: {
      title: "کد ورود را وارد کنید",
      sentTo: "یک کد ۶ رقمی به {{email}} فرستادیم. این کد تا ۱۰ دقیقه معتبر است.",
      label: "کد ۶ رقمی",
      submit: "تأیید و ورود",
      checking: "در حال بررسی…",
      resend: "ارسال دوباره‌ی کد",
      resendIn: "ارسال دوباره تا {{seconds}} ثانیه‌ی دیگر",
      resent: "کد تازه فرستاده شد.",
      changeEmail: "تغییر ایمیل",
      checkSpam: "ایمیل نرسید؟ پوشه‌ی اسپم را هم نگاه کنید.",
    },
    secondFactor: {
      title: "ورود دومرحله‌ای",
      description: "کد ۶ رقمی برنامه‌ی احراز هویت (مثل Google Authenticator) را وارد کنید.",
      label: "کد برنامه یا کد بازیابی",
      recoveryHint:
        "به گوشی دسترسی ندارید؟ یکی از کدهای بازیابی خود را (مثل ABCD-EFGH) وارد کنید.",
      submit: "تأیید",
    },
    setup: {
      title: "راه‌اندازی ورود دومرحله‌ای",
      requiredForStaff:
        "حساب‌های کارمندان تا ورود دومرحله‌ای را راه نیندازند، به هیچ بخشی دسترسی ندارند.",
      optional: "با این کار، برای ورود به حساب علاوه بر ایمیل یا رمز، کد گوشی‌تان هم لازم می‌شود.",
      scan:
        "برنامه‌ی احراز هویت (Google Authenticator، Microsoft Authenticator یا 2FAS) را باز کنید و این QR را اسکن کنید.",
      qrAlt: "QR برای افزودن حساب شاه‌کلید به برنامه‌ی احراز هویت",
      cantScan: "نمی‌توانید اسکن کنید؟ این کلید را دستی در برنامه وارد کنید:",
      copyKey: "کپی کلید",
      enterCode: "حالا کد ۶ رقمی‌ای را که برنامه نشان می‌دهد وارد کنید.",
      codeLabel: "کد برنامه",
      submit: "فعال‌سازی",
      preparing: "در حال آماده‌سازی…",
      enabled: "ورود دومرحله‌ای فعال شد.",
    },
    recovery: {
      title: "کدهای بازیابی را نگه دارید",
      description:
        "اگر گوشی‌تان گم شود، با هر کدام از این کدها یک بار می‌توانید وارد شوید. این کدها فقط همین حالا نشان داده می‌شوند.",
      copy: "کپی همه‌ی کدها",
      copied: "کپی شد.",
      confirm: "کدها را جای امنی ذخیره کردم",
      continue: "ادامه",
    },
    forgot: {
      title: "بازیابی رمز عبور",
      description: "ایمیل حسابتان را وارد کنید تا کد تغییر رمز برایتان بفرستیم.",
      sendCode: "ارسال کد",
      sentTo: "اگر حسابی با {{email}} وجود داشته باشد، کد تغییر رمز به آن فرستاده شد.",
      codeLabel: "کد ایمیل‌شده",
      newPassword: "رمز عبور تازه",
      newPasswordHint:
        "دست‌کم ۸ نویسه. یک عبارت بلند از چند کلمه، از یک رمز کوتاه پیچیده امن‌تر است.",
      submit: "تغییر رمز",
      done: "رمز شما عوض شد. حالا با رمز تازه وارد شوید.",
      backToSignIn: "بازگشت به صفحه‌ی ورود",
    },
    profile: {
      title: "حساب من",
      email: "ایمیل",
      staff: "کارمند",
      password: "رمز عبور",
      passwordSet: "تعیین شده است.",
      passwordNotSet: "هنوز رمزی ندارید و با کد ایمیلی وارد می‌شوید. می‌توانید یک رمز هم تعیین کنید.",
      passwordChangeHint: "برای عوض کردن رمز، از خروج و «رمز را فراموش کرده‌اید؟» استفاده کنید.",
      setPassword: "تعیین رمز",
      passwordSaved: "رمز عبور ذخیره شد.",
      twoFactor: "ورود دومرحله‌ای",
      twoFactorOn: "فعال است.",
      twoFactorOff: "فعال نیست.",
      enableTwoFactor: "فعال‌سازی ورود دومرحله‌ای",
      signOut: "خروج از حساب",
      signedOut: "از حساب خارج شدید.",
    },
  },
  language: {
    fa: "فارسی",
    en: "English",
  },
} as const;
