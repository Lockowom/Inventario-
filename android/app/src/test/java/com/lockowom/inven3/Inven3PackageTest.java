package com.lockowom.inven3;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class Inven3PackageTest {

    @Test
    public void applicationId_isInven3() {
        assertEquals("com.lockowom.inven3", BuildConfig.APPLICATION_ID);
    }
}
