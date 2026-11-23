from backend.app.compare import insecure_compare, secure_compare


def test_both_accept_correct_pin():
    assert insecure_compare("123456", "123456")
    assert secure_compare("123456", "123456")


def test_both_reject_wrong_pin():
    assert not insecure_compare("123450", "123456")
    assert not secure_compare("123450", "123456")