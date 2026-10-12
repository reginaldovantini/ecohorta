import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Quais dados a EcoHorta Inteligente coleta, por quê, por quanto tempo e como pedir a exclusão.",
};

/** Última revisão desta política. Mudou o texto, muda a data. */
const ATUALIZADA_EM = "11 de outubro de 2026";

export default function PrivacidadePage() {
  return (
    <>
      <h1>Política de Privacidade</h1>
      <p className="lead">
        A EcoHorta Inteligente é usada por estudantes, muitos deles menores de idade. Esta política diz, sem rodeios,
        quais dados a plataforma guarda, para que servem e como apagá-los.
      </p>
      <p className="meta">Atualizada em {ATUALIZADA_EM}</p>

      <h2>Quem é responsável</h2>
      <p>
        O projeto EcoHorta Inteligente é conduzido na <strong>EE Prof.ª Clarinda Mendes de Aquino</strong>, como projeto
        escolar inscrito no Samsung Solve for Tomorrow Brasil. O responsável pelo tratamento dos dados é a coordenação do
        projeto, pelo e-mail <a href="mailto:professorvantini@gmail.com">professorvantini@gmail.com</a>.
      </p>
      <p>
        Não somos uma empresa e não vendemos nada. A plataforma existe para que a água de condensação do ar-condicionado
        deixe de ir para o ralo e vire ação concreta na escola.
      </p>

      <h2>Quais dados a plataforma guarda</h2>
      <h3>Dados que você informa ao entrar</h3>
      <ul>
        <li>
          <strong>E-mail</strong> — vem da sua conta Google quando você entra. É o que identifica a sua conta.
        </li>
        <li>
          <strong>Primeiro nome ou apelido</strong> — como você quer ser chamado na plataforma. Não exigimos nome
          completo.
        </li>
        <li>
          <strong>Sexo</strong> e <strong>data de nascimento</strong>.
        </li>
        <li>
          <strong>Função na escola</strong> — estudante, professor(a) ou funcionário(a) — e, para estudantes, o{" "}
          <strong>ano/série</strong>.
        </li>
        <li>
          <strong>Avatar</strong> escolhido entre os desenhos do aplicativo.
        </li>
      </ul>

      <h3>Dados gerados pelo uso</h3>
      <ul>
        <li>
          <strong>Escolas a que você pertence</strong> e a que está usando no momento.
        </li>
        <li>
          <strong>Leituras do QR Code dos captadores</strong> — quando e em qual captador. Isso registra que você esteve
          fisicamente na frente do tubo, que é o que autoriza abrir a água.
        </li>
        <li>
          <strong>Missões realizadas</strong> — qual missão, qual captador, quantos litros o sensor mediu e quando.
        </li>
        <li>
          <strong>Pontos, níveis e conquistas</strong>, e a sua posição nos rankings.
        </li>
        <li>
          <strong>Publicações no mural</strong> — a foto que você escolher enviar, a missão correspondente e o impacto.
        </li>
      </ul>

      <h3>O que a plataforma NÃO coleta</h3>
      <ul>
        <li>Não pedimos CPF, RG, endereço nem telefone.</li>
        <li>Não usamos a localização do seu celular. A presença no captador é provada lendo o QR Code colado no tubo.</li>
        <li>Não acessamos sua agenda, seus contatos, seus arquivos nem seus outros dados do Google.</li>
        <li>Não há anúncios, nem rastreadores de publicidade, nem venda de dados a ninguém.</li>
      </ul>
      <p>
        Do Google recebemos apenas o <strong>endereço de e-mail</strong> da conta usada para entrar. Nada além disso.
      </p>

      <h2>Para que esses dados são usados</h2>
      <ul>
        <li>
          <strong>Fazer a plataforma funcionar</strong>: mostrar os captadores da sua escola, liberar missões e registrar
          o que foi feito.
        </li>
        <li>
          <strong>Garantir que a água seja liberada por quem está lá</strong>: abrir uma válvula molha o chão de verdade,
          então o servidor exige a leitura do QR do captador antes de liberar.
        </li>
        <li>
          <strong>Jogo e reconhecimento</strong>: pontos, níveis, conquistas e rankings entre pessoas da mesma escola e
          entre escolas.
        </li>
        <li>
          <strong>Indicadores de impacto</strong>: quantos litros a escola — e a rede de escolas — reaproveitou.
        </li>
      </ul>
      <p>
        Nos rankings e no mural aparecem o <strong>apelido</strong> e o <strong>avatar</strong>. O e-mail e a data de
        nascimento nunca aparecem para outras pessoas.
      </p>

      <h2>Fotos no mural</h2>
      <p>
        Publicar foto é <strong>opcional</strong>. Uma missão se conclui pelo volume medido pelo sensor, nunca por uma
        foto, e ninguém perde pontos por não publicar.
      </p>
      <p>
        Para estudantes menores de idade, a foto só é publicada se houver <strong>autorização do responsável para uso de
        imagem</strong>, registrada pela escola. Essa autorização é separada da autorização de participar do projeto: dá
        para participar de tudo sem nunca aparecer em foto, e a autorização de imagem pode ser retirada depois sem que
        isso afete a participação.
      </p>
      <p>Qualquer publicação pode ser denunciada dentro do aplicativo e removida pela equipe da escola.</p>

      <h2>Base legal (LGPD)</h2>
      <p>
        O tratamento segue a Lei 13.709/2018. Para crianças e adolescentes vale o artigo 14: os dados são tratados no seu
        melhor interesse, e a participação de menores depende de <strong>autorização do responsável</strong>, registrada
        pela escola antes do uso. A plataforma guarda esse registro por finalidade — participar e uso de imagem — e
        permite revogar cada uma separadamente.
      </p>

      <h2>Com quem os dados são compartilhados</h2>
      <p>Com ninguém, para fins comerciais. Tecnicamente, a plataforma se apoia em três serviços:</p>
      <ul>
        <li>
          <strong>Google</strong> — apenas para você entrar com sua conta. O Google nos informa seu e-mail; nós não
          enviamos seus dados da EcoHorta para ele.
        </li>
        <li>
          <strong>Supabase</strong> — onde fica o banco de dados, em servidores na <strong>região de São Paulo</strong>.
        </li>
        <li>
          <strong>Vercel</strong> — onde o aplicativo é servido. O processamento das requisições pode ocorrer em
          servidores fora do Brasil.
        </li>
      </ul>
      <p>Dados podem ser apresentados de forma agregada e sem identificação em relatórios e apresentações do projeto.</p>

      <h2>Por quanto tempo ficam guardados</h2>
      <p>
        Enquanto você participa do projeto. Ao sair da escola ou pedir a exclusão, os dados que te identificam são
        apagados. Os registros de litros captados e reutilizados podem ser mantidos <strong>sem identificação</strong>,
        porque compõem o histórico ambiental da escola — água que a escola reaproveitou não deixa de ter sido
        reaproveitada.
      </p>

      <h2>Seus direitos</h2>
      <p>Você, ou seu responsável, pode a qualquer momento:</p>
      <ul>
        <li>saber quais dados seus a plataforma tem;</li>
        <li>corrigir o que estiver errado;</li>
        <li>pedir a exclusão da conta e dos dados pessoais;</li>
        <li>retirar a autorização de uso de imagem, sem sair do projeto;</li>
        <li>pedir uma cópia dos seus dados.</li>
      </ul>
      <p>
        Basta falar com a coordenação do projeto na escola ou escrever para{" "}
        <a href="mailto:professorvantini@gmail.com">professorvantini@gmail.com</a>. Respondemos em até 15 dias.
      </p>

      <h2>Segurança</h2>
      <p>
        O acesso aos dados é restrito por regras no próprio banco: cada pessoa só enxerga o que é da escola dela, e
        nenhuma escrita acontece direto do navegador. Senhas de dispositivos e códigos de responsável são guardados
        apenas como resumo criptográfico — nem a equipe do projeto consegue lê-los de volta.
      </p>

      <h2>Mudanças nesta política</h2>
      <p>
        Se algo mudar, a data no topo muda junto, e alterações relevantes serão avisadas dentro do aplicativo.
      </p>
    </>
  );
}
