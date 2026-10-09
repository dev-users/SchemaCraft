"""Developer utility for creating the Builder password before packaging."""
from __future__ import annotations

import getpass

import SchemaCraft as app


def main() -> int:
    print()
    print("إعداد كلمة مرور المصمّم")
    print("يجب أن تتكون من 8 أحرف على الأقل.")
    password = getpass.getpass("كلمة المرور الجديدة: ")
    confirmation = getpass.getpass("تأكيد كلمة المرور: ")
    if password != confirmation:
        print("تأكيد كلمة المرور غير مطابق.")
        return 1
    try:
        app.set_builder_password(password)
    except app.ApplicationError as exc:
        print(str(exc))
        return 1
    print("تم حفظ كلمة المرور بصورة مشفرة في builder-auth.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
