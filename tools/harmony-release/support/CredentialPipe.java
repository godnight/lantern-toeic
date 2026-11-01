import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

// Passwords enter through an anonymous pipe, never command-line arguments.
public class CredentialPipe {
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String store = new String(Base64.getDecoder().decode(input.readLine()), StandardCharsets.UTF_8);
        String key = new String(Base64.getDecoder().decode(input.readLine()), StandardCharsets.UTF_8);
        ArrayList<String> command = new ArrayList<>(Arrays.asList(args));
        command.addAll(Arrays.asList("-keystorePwd", store, "-keyPwd", key));
        Class.forName("com.ohos.hapsigntool.HapSignTool").getMethod("main", String[].class)
            .invoke(null, (Object) command.toArray(new String[0]));
    }
}
